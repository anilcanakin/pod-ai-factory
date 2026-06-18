const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { assetQueue } = require('../queues/index');

const prisma = require('../lib/prisma');

// POST /api/pipeline/run — single image pipeline trigger
router.post('/run', async (req, res) => {
    try {
        const { imageId } = req.body;
        if (!imageId) return res.status(400).json({ error: 'imageId is required' });

        const image = await prisma.image.findFirst({ where: { id: imageId, job: { workspaceId: req.workspaceId } } });
        if (!image) return res.status(404).json({ error: 'Image not found.' });
        if (!['APPROVED', 'PROCESSED', 'COMPLETED'].includes(image.status) && !image.isApproved) {
            return res.status(400).json({ error: 'Only APPROVED images can enter the pipeline.' });
        }

        console.log('[API] İşi Redis kuyruğuna fırlatıyor. Kuyruk:', assetQueue.name, 'Job: processAsset | imageId:', imageId);
        await assetQueue.add('processAsset', { imageId }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 }
        });

        const updated = await prisma.image.findUnique({ where: { id: imageId } });
        res.json({ message: 'Asset pipeline completed.', imageId, status: updated?.status });
    } catch (err) {
        console.error('[Pipeline /run]', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/pipeline/run-job/:jobId — process ALL approved images for a job (idempotent)
router.post('/run-job/:jobId', async (req, res) => {
    const { jobId } = req.params;
    try {
        const approvedImages = await prisma.image.findMany({
            where: {
                jobId,
                job: { workspaceId: req.workspaceId },
                OR: [
                    { isApproved: true },
                    { status: 'APPROVED' }
                ]
            }
        });

        if (approvedImages.length === 0) {
            return res.status(400).json({
                error: 'No approved images found for this job. Approve images in Gallery first.',
                jobId
            });
        }

        const results = [];
        let successCount = 0;
        let failCount = 0;

        for (const image of approvedImages) {
            // Idempotent: skip already processed
            if (image.status === 'PROCESSED' || image.status === 'COMPLETED') {
                results.push({ imageId: image.id, status: 'SKIPPED_ALREADY_PROCESSED' });
                continue;
            }

            try {
                // Enqueue to BullMQ instead of processing synchronously
                console.log('[API] İşi Redis kuyruğuna fırlatıyor. Kuyruk:', assetQueue.name, 'Job: processAsset | imageId:', image.id);
                await assetQueue.add('processAsset', { imageId: image.id }, {
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 2000 }
                });
                successCount++;
                results.push({ imageId: image.id, status: 'ENQUEUED' });
            } catch (err) {
                failCount++;
                results.push({ imageId: image.id, status: 'FAILED_TO_ENQUEUE', error: err.message });
            }
        }

        res.json({
            jobId,
            message: `Pipeline completed: ${successCount} processed, ${failCount} failed, ${results.filter(r => r.status === 'SKIPPED_ALREADY_PROCESSED').length} skipped.`,
            results
        });
    } catch (err) {
        console.error('[Pipeline /run-job]', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/pipeline/status/:jobId — pipeline progress for a job
router.get('/status/:jobId', async (req, res) => {
    try {
        const images = await prisma.image.findMany({
            where: { jobId: req.params.jobId, job: { workspaceId: req.workspaceId }, OR: [{ isApproved: true }, { status: { in: ['PROCESSED', 'COMPLETED'] } }] },
            select: { id: true, status: true, masterFileUrl: true, isApproved: true }
        });
        res.json(images);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/pipeline/one-click — BG Remove → Mockup → SEO in one request
router.post('/one-click', async (req, res) => {
    try {
        const { imageId, imageUrl, templateIds = [], bgModel = 'birefnet', options = {} } = req.body;
        const workspaceId = req.workspaceId;

        if (!workspaceId) return res.status(401).json({ error: 'Unauthorized' });
        if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });

        const { fal } = require('@fal-ai/client');
        const Anthropic = require('@anthropic-ai/sdk');

        const results = {
            imageId,
            steps: {},
            finalImageUrl: imageUrl,
            status: 'running'
        };

        // Own-server assets (relative OR full http://host/assets/...) → resolve to disk once
        // process.cwd() = project root on both Linux (/home/anilcan/pod-ai-factory) and Windows
        const assetMatch = imageUrl.match(/assets\/.*/);
        const localPath = assetMatch ? path.join(process.cwd(), assetMatch[0]) : null;

        // ── Step 1: BG Remove ──────────────────────────────────────
        if (options.bgRemove !== false) {
            try {
                const falModelMap = {
                    birefnet: 'fal-ai/birefnet',
                    bria: 'fal-ai/bria/background/remove',
                    pixelcut: 'pixelcut/background-removal'
                };
                const falModel = falModelMap[bgModel] || 'fal-ai/birefnet';
                console.log(`[Pipeline:OneClick] Step 1: BG Remove (${falModel})`);

                // Own-server assets → base64 data URI (FAL can't reach localhost/Tailscale)
                let falImageUrl = imageUrl;
                if (localPath) {
                    const buf = fs.readFileSync(localPath);
                    const ext = (path.extname(localPath).slice(1) || 'png').toLowerCase();
                    const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : `image/${ext}`;
                    falImageUrl = `data:${mime};base64,${buf.toString('base64')}`;
                }

                const bgResult = await fal.subscribe(falModel, {
                    input: { image_url: falImageUrl }
                });
                const bgUrl = bgResult?.data?.image?.url || bgResult?.image?.url || null;

                if (bgUrl) {
                    results.steps.bgRemove = { status: 'success', url: bgUrl };
                    results.finalImageUrl = bgUrl;

                    // Persist to DB under a shared "processed" job
                    const processedJob = await prisma.designJob.findFirst({
                        where: { workspaceId, mode: 'processed' }
                    }) || await prisma.designJob.create({
                        data: { workspaceId, originalImage: 'processed', mode: 'processed', status: 'COMPLETED', basePrompt: 'Processed Images' }
                    });

                    const savedBg = await prisma.image.create({
                        data: { jobId: processedJob.id, variantType: 'bg_removed', promptUsed: 'Pipeline BG Remove', engine: 'bg_remove', imageUrl: bgUrl, status: 'COMPLETED', isApproved: true, cost: 0 }
                    });
                    results.steps.bgRemove.imageId = savedBg.id;
                } else {
                    results.steps.bgRemove = { status: 'failed', error: 'No output URL returned' };
                }
            } catch (err) {
                console.error('[Pipeline:OneClick] BG Remove failed:', err.message);
                if (err.stack) console.error('[Pipeline:OneClick] BG Remove trace:', err.stack.split('\n').slice(0, 3).join(' | '));
                results.steps.bgRemove = { status: 'failed', error: err.message };
            }
        }

        // ── Step 2: Mockup Render ──────────────────────────────────
        if (templateIds.length > 0) {
            results.steps.mockups = [];
            const { renderMockup } = require('../services/mockup-render.service');

            for (const templateId of templateIds.slice(0, 5)) {
                try {
                    console.log('[Pipeline:OneClick] Step 2: Mockup for:', templateId);
                    const template = await prisma.mockupTemplate.findUnique({ where: { id: templateId } });
                    if (!template) continue;

                    const designImageId = results.steps.bgRemove?.imageId || imageId;

                    // Own-server assets → absolute disk path; FAL CDN/external URLs pass through
                    const assetM = results.finalImageUrl.match(/assets\/.*/);
                    const resolvedDesignPath = assetM
                        ? path.join(process.cwd(), assetM[0])
                        : results.finalImageUrl;

                    const mockupResult = await renderMockup({
                        designPath: resolvedDesignPath,
                        template,
                        imageId: designImageId,
                        workspaceId,
                    });

                    if (mockupResult) {
                        const mockupJob = await prisma.designJob.findFirst({
                            where: { workspaceId, mode: 'mockup_gallery' }
                        }) || await prisma.designJob.create({
                            data: { workspaceId, originalImage: 'mockup_gallery', mode: 'mockup_gallery', status: 'COMPLETED', basePrompt: 'Mockup Gallery' }
                        });

                        await prisma.image.create({
                            data: { jobId: mockupJob.id, variantType: 'mockup', promptUsed: `Pipeline Mockup - ${template.name}`, engine: 'mockup', imageUrl: mockupResult, status: 'COMPLETED', isApproved: true, cost: 0 }
                        });

                        results.steps.mockups.push({ templateId, templateName: template.name, status: 'success', url: mockupResult });
                    }
                } catch (err) {
                    console.error(`[Pipeline:OneClick] Mockup failed for ${templateId}:`, err.message);
                    if (err.stack) console.error(`[Pipeline:OneClick] Mockup trace:`, err.stack.split('\n').slice(0, 3).join(' | '));
                    results.steps.mockups.push({ templateId, status: 'failed', error: err.message });
                }
            }
        }

        // ── Step 3: SEO Generation ────────────────────────────────
        if (options.seo !== false) {
            try {
                console.log('[Pipeline:OneClick] Step 3: SEO');
                const { expandKeywords } = require('../services/keyword-research.service');
                const { getSeoContext } = require('../services/knowledge-context.service');
                const visionService = require('../services/vision.service');

                // Vision analysis — analyzeImage expects raw base64 + mime, never a URL
                let imageDescription = '';
                try {
                    let visionBase64, visionMime;
                    const visionUrl = results.finalImageUrl;
                    if (visionUrl.startsWith('data:')) {
                        const [header, data] = visionUrl.split(',');
                        visionBase64 = data;
                        visionMime = header.match(/data:([^;]+)/)?.[1] || 'image/png';
                    } else {
                        let buf;
                        const assetMv = visionUrl.match(/assets\/.*/);
                        if (assetMv) {
                            buf = fs.readFileSync(path.join(process.cwd(), assetMv[0]));
                        } else {
                            const fetchMod = require('node-fetch');
                            const resp = await fetchMod(visionUrl);
                            buf = await resp.buffer();
                        }
                        const ext = (path.extname(visionUrl.split('?')[0]).slice(1) || 'png').toLowerCase();
                        visionMime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : `image/${ext}`;
                        visionBase64 = buf.toString('base64');
                    }
                    const visionResult = await visionService.analyzeImage(visionBase64, visionMime);
                    imageDescription = visionResult.prompt || '';
                } catch (e) {
                    console.warn('[Pipeline:OneClick] Vision failed:', e.message);
                }

                const [expandedResult, knowledgeResult] = await Promise.allSettled([
                    expandKeywords([imageDescription.split(' ').slice(0, 3).join(' ')]),
                    getSeoContext(workspaceId)
                ]);

                const etsyKeywords = expandedResult.status === 'fulfilled' ? expandedResult.value : [];
                const knowledge = knowledgeResult.status === 'fulfilled' ? knowledgeResult.value : '';

                const client = new Anthropic();
                const seoResponse = await client.messages.create({
                    model: 'claude-haiku-4-5',
                    max_tokens: 4096,
                    system: `${knowledge}\n\nReturn ONLY valid JSON. Keep description under 300 characters. Format: {"title":"...","description":"...","tags":["tag1",...,"tag13"],"topKeywords":["kw1","kw2","kw3"]}`,
                    messages: [{
                        role: 'user',
                        content: `Create Etsy SEO for this POD design: ${imageDescription}\nReal Etsy searches: ${etsyKeywords.slice(0, 10).join(', ')}`
                    }]
                });

                const rawText = seoResponse.content[0].text;
                console.log(`[Pipeline:SEO] stop_reason=${seoResponse.stop_reason} output_tokens=${seoResponse.usage?.output_tokens} raw_len=${rawText.length}`);

                const seoRaw = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
                const seoStart = seoRaw.indexOf('{');
                const seoEnd   = seoRaw.lastIndexOf('}');
                if (seoStart === -1 || seoEnd === -1 || seoEnd <= seoStart) {
                    console.error(`[Pipeline:SEO] JSON sınırı bulunamadı — ham yanıt (500): ${seoRaw.slice(0, 500)}`);
                    throw new Error('SEO yanıtı JSON içermiyor');
                }

                let seo;
                try {
                    seo = JSON.parse(seoRaw.slice(seoStart, seoEnd + 1));
                } catch (parseErr) {
                    console.error(`[Pipeline:SEO] JSON parse hatası: ${parseErr.message}`);
                    console.error(`[Pipeline:SEO] ham yanıt (500 karakter): ${seoRaw.slice(0, 500)}`);
                    // Fallback: regex extraction — truncated JSON'dan kurtarılabileni al, pipeline çökmesin
                    const titleM = seoRaw.match(/"title"\s*:\s*"([^"]{1,140})"/);
                    const tagsM  = seoRaw.match(/"tags"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
                    const extractedTags = tagsM
                        ? (tagsM[1].match(/"([^"]{1,20})"/g) || []).map(t => t.replace(/"/g, '')).slice(0, 13)
                        : [];
                    seo = {
                        title:       titleM ? titleM[1] : imageDescription.slice(0, 100),
                        description: 'Unique print-on-demand design, perfect as a gift or for yourself.',
                        tags:        extractedTags.length > 0 ? extractedTags : ['print on demand', 'custom design', 'unique gift'],
                        topKeywords: [],
                        _fallback:   true
                    };
                    console.warn(`[Pipeline:SEO] Fallback SEO — title: "${seo.title}" | tags: ${seo.tags.length}`);
                }
                seo.title = (seo.title || '').slice(0, 140);
                seo.tags = (seo.tags || []).slice(0, 13);

                results.steps.seo = {
                    status: seo._fallback ? 'partial' : 'success',
                    title: seo.title,
                    description: seo.description,
                    tags: seo.tags,
                    topKeywords: seo.topKeywords || [],
                    ...(seo._fallback && { warning: 'SEO JSON truncated — fallback used' })
                };
            } catch (err) {
                console.warn('[Pipeline:OneClick] SEO failed:', err.message);
                results.steps.seo = { status: 'failed', error: err.message };
            }
        }

        results.status = 'completed';
        res.json(results);

    } catch (err) {
        console.error('[Pipeline:OneClick]', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
