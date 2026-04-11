const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { processAsset } = require('../queues/asset.worker');
const { assetQueue } = require('../queues/index');

const prisma = new PrismaClient();

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

        console.log(`[Pipeline] Starting for image: ${imageId} via BullMQ`);
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
        const { imageId, imageUrl, templateIds = [], options = {} } = req.body;
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

        // ── Step 1: BG Remove ──────────────────────────────────────
        if (options.bgRemove !== false) {
            try {
                console.log('[Pipeline:OneClick] Step 1: BG Remove');
                const bgResult = await fal.subscribe('fal-ai/birefnet', {
                    input: { image_url: imageUrl }
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
                console.warn('[Pipeline:OneClick] BG Remove failed:', err.message);
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
                    const mockupResult = await renderMockup(template, designImageId, {});

                    if (mockupResult?.url) {
                        const mockupJob = await prisma.designJob.findFirst({
                            where: { workspaceId, mode: 'mockup_gallery' }
                        }) || await prisma.designJob.create({
                            data: { workspaceId, originalImage: 'mockup_gallery', mode: 'mockup_gallery', status: 'COMPLETED', basePrompt: 'Mockup Gallery' }
                        });

                        await prisma.image.create({
                            data: { jobId: mockupJob.id, variantType: 'mockup', promptUsed: `Pipeline Mockup - ${template.name}`, engine: 'mockup', imageUrl: mockupResult.url, status: 'COMPLETED', isApproved: true, cost: 0 }
                        });

                        results.steps.mockups.push({ templateId, templateName: template.name, status: 'success', url: mockupResult.url });
                    }
                } catch (err) {
                    console.warn('[Pipeline:OneClick] Mockup failed for:', templateId, err.message);
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

                // Vision analysis
                let imageDescription = '';
                try {
                    const visionResult = await visionService.analyzeImage(
                        results.finalImageUrl.startsWith('data:')
                            ? results.finalImageUrl.split(',')[1]
                            : results.finalImageUrl,
                        'image/jpeg'
                    );
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
                    max_tokens: 1500,
                    system: `${knowledge}\n\nReturn ONLY valid JSON: {"title":"...","description":"...","tags":["tag1",...,"tag13"],"topKeywords":["kw1","kw2","kw3"]}`,
                    messages: [{
                        role: 'user',
                        content: `Create Etsy SEO for this POD design: ${imageDescription}\nReal Etsy searches: ${etsyKeywords.slice(0, 10).join(', ')}`
                    }]
                });

                const seoRaw = seoResponse.content[0].text.replace(/```json|```/g, '').trim();
                const seo = JSON.parse(seoRaw);
                seo.title = seo.title.slice(0, 140);
                seo.tags = (seo.tags || []).slice(0, 13);

                results.steps.seo = {
                    status: 'success',
                    title: seo.title,
                    description: seo.description,
                    tags: seo.tags,
                    topKeywords: seo.topKeywords || []
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
