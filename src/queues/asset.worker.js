const { Worker } = require('bullmq');
const redisConnection = require('../config/redis');
const fs   = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const sharp = require('sharp');
const safetyService  = require('../services/safety.service');
const falProvider    = require('../services/providers/fal.provider');
const anthropic      = require('../lib/anthropic');
const prisma         = require('../lib/prisma');

const outputDir = path.join(__dirname, '../../assets/outputs');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createNormalizedMaster(imageUrl, imageId) {
    const filename = `${imageId}_master_4500x5400.png`;
    const filepath = path.join(outputDir, filename);

    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`Master download failed: ${res.status}`);
    const buf = await res.buffer();

    // 5% margin on each side → design area 4275×5130
    const designBuf = await sharp(buf)
        .resize(4275, 5130, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();

    await sharp({ create: { width: 4500, height: 5400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: designBuf, top: 135, left: 113 }])
        .png()
        .toFile(filepath);

    return `assets/outputs/${filename}`;
}

async function renderWorkspaceMockups(imageUrl, imageId, workspaceId) {
    const templates = await prisma.mockupTemplate.findMany({
        where: { workspaceId },
        take: 2,
        orderBy: { createdAt: 'desc' },
    });

    if (templates.length === 0) {
        console.log('[AssetWorker] Workspace için mockup template yok — mockup adımı atlanıyor');
        return [];
    }

    const { renderMockup } = require('../services/mockup-render.service');
    const results = [];

    for (const template of templates) {
        try {
            const mockupUrl = await renderMockup({
                designPath: imageUrl,
                template,
                imageId,
                workspaceId,
                placement: {},
            });
            results.push({ mockupUrl, templateId: template.id });
            console.log(`[AssetWorker] Mockup hazır: ${template.name} → ${mockupUrl}`);
        } catch (err) {
            console.warn(`[AssetWorker] Mockup başarısız (${template.id}): ${err.message}`);
        }
    }

    return results;
}

async function generateSeo(image, workspaceId) {
    const { getSeoContext } = require('../services/knowledge-context.service');

    const topic = image.job?.keyword || image.job?.niche || image.job?.basePrompt || 'POD design';
    const knowledge = await getSeoContext(workspaceId).catch(() => '');

    const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: `${knowledge}\n\nReturn ONLY valid JSON, no markdown fences: {"title":"...","description":"...","tags":["tag1","tag2",...,"tag13"]}`,
        messages: [{
            role: 'user',
            content: `Generate Etsy SEO for a print-on-demand product. Keyword/niche: "${topic}". Title max 140 chars, exactly 13 Etsy tags.`,
        }],
    });

    const raw = response.content[0].text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);

    return {
        title:       (parsed.title || topic).slice(0, 140),
        description: parsed.description || '',
        tags:        (parsed.tags || []).slice(0, 13),
    };
}

// ─── Core Worker ──────────────────────────────────────────────────────────────

async function processAsset(job) {
    console.log('[AssetWorker] İş kuyruktan yakalandı! JobID:', job.id, '| imageId:', job.data.imageId);
    const { imageId } = job.data;
    if (!imageId) {
        console.warn('[AssetWorker] Job data missing imageId, skipping.');
        return;
    }

    try {
        const image = await prisma.image.findUnique({
            where: { id: imageId },
            include: { job: true },
        });

        if (!image) throw new Error(`Image ${imageId} not found`);
        if (image.status !== 'APPROVED') {
            console.log(`Skipping image ${imageId} because status is ${image.status}, not APPROVED.`);
            return;
        }

        const workspaceId = image.job?.workspaceId || 'default-workspace';
        console.log(`[AssetWorker] Processing APPROVED image: ${imageId} | workspace: ${workspaceId}`);

        // 1. BG Remove (graceful fallback to original on API error)
        let noBgUrl = image.imageUrl;
        try {
            const bgResult = await falProvider.removeBackground(image.imageUrl, workspaceId);
            noBgUrl = bgResult.image_url;
            console.log(`[AssetWorker] BG Removed -> ${noBgUrl}`);
        } catch (err) {
            console.warn(`[AssetWorker] BG remove başarısız (orijinal kullanılıyor): ${err.message}`);
        }

        // 2. Upscale (graceful fallback to no-bg URL)
        let upscaledUrl = noBgUrl;
        try {
            const upResult = await falProvider.upscaleImage(noBgUrl, 4, workspaceId);
            upscaledUrl = upResult.image_url;
            console.log(`[AssetWorker] Upscaled -> ${upscaledUrl}`);
        } catch (err) {
            console.warn(`[AssetWorker] Upscale başarısız (no-bg görsel kullanılıyor): ${err.message}`);
        }

        // 3. Create 4500×5400 master PNG
        const masterFileUrl = await createNormalizedMaster(upscaledUrl, imageId);
        console.log(`[AssetWorker] Master oluşturuldu -> ${masterFileUrl}`);

        // 4. Render workspace mockups (empty if no templates defined)
        const mockupsData = await renderWorkspaceMockups(upscaledUrl, imageId, workspaceId);
        console.log(`[AssetWorker] Mockup sayısı: ${mockupsData.length}`);

        // 5. SEO generation via Claude Haiku + Brain context
        let seoData;
        try {
            seoData = await generateSeo(image, workspaceId);
        } catch (err) {
            console.warn(`[AssetWorker] SEO üretimi başarısız (fallback): ${err.message}`);
            const fallbackTitle = (image.job?.keyword || image.job?.niche || 'Unique POD Design').slice(0, 140);
            seoData = { title: fallbackTitle, description: '', tags: [] };
        }

        // 6. Delete old mockups & SEO to prevent constraint errors on retry
        await prisma.mockup.deleteMany({ where: { imageId } });
        await prisma.sEOData.deleteMany({ where: { imageId } });

        // 7. Legal Guard
        const safety = await safetyService.validateLegalSafety(seoData);

        if (!safety.isSafe) {
            console.error(`[AssetWorker] 🚔 LEGAL GUARD UYARISI: Image ${imageId} ban riski taşıyor!`);
            await prisma.image.update({
                where: { id: imageId },
                data: {
                    masterFileUrl,
                    status:     'FLAGGED',
                    flagReason: safety.reason,
                    seoData:    { create: seoData },
                    mockups:    { create: mockupsData },
                },
            });
            const taskService = require('../services/task.service');
            await taskService.incrementTask('GENERATION');
            return { masterFileUrl, mockups: mockupsData.length, hasSeo: true, flagged: true, reason: safety.reason };
        }

        // 8. Save all pipeline assets to DB
        await prisma.image.update({
            where: { id: imageId },
            data: {
                masterFileUrl,
                status:     'PENDING_APPROVAL',
                flagReason: null,
                seoData:    { create: seoData },
                mockups:    { create: mockupsData },
            },
        });

        console.log(`[AssetWorker] ✅ ${imageId} → PENDING_APPROVAL`);
        const taskService = require('../services/task.service');
        await taskService.incrementTask('GENERATION');

        return { masterFileUrl, mockups: mockupsData.length, hasSeo: true, drafted: false, pendingApproval: true };

    } catch (err) {
        console.error(`[AssetWorker] Error processing image ${imageId}:`, err);
        await prisma.image.update({
            where: { id: imageId },
            data: { status: 'FAILED' },
        });
        throw err;
    }
}

// ─── BullMQ Worker ────────────────────────────────────────────────────────────

const worker = new Worker('asset-processing', processAsset, {
    connection: redisConnection,
    concurrency: 2,
});

worker.on('active', (job) => {
    console.log(`[AssetWorker] ▶  İş başladı  | jobId=${job.id} | imageId=${job.data.imageId}`);
});

worker.on('completed', (job, result) => {
    const mockupCount = result?.mockups ?? 0;
    console.log(`[AssetWorker] ✓  İş tamamlandı | jobId=${job.id} | imageId=${job.data.imageId} | mockups=${mockupCount}`);
});

worker.on('failed', (job, err) => {
    console.error(`[AssetWorker] ✗  İş başarısız | jobId=${job?.id} | imageId=${job?.data?.imageId} | hata=${err.message}`);
});

worker.on('stalled', (jobId) => {
    console.warn(`[AssetWorker] ⚠  İş takıldı (stalled) | jobId=${jobId}`);
});

worker.on('error', (err) => {
    console.error('[AssetWorker] Worker hatası:', err.message);
});

console.log('[AssetWorker] ✔  Kuyruk dinleniyor → asset-processing');

module.exports = { worker, processAsset };
