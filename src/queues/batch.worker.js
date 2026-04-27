/**
 * batch.worker.js — Industrial Mode Worker
 *
 * Her görsel arasına 2 saniye delay koyarak FAL.ai rate-limit'ten kaçınır.
 * Sıra: generate → RMBG → Supabase upload → DB güncelle → finance kayıt
 */

const { Worker } = require('bullmq');
const redisConnection = require('../config/redis');
const { recordExpense } = require('../services/finance.service');

const prisma = require('../lib/prisma');

const MODEL_COSTS = {
    'fal-ai/flux/schnell': 0.003,
    'fal-ai/flux/dev':     0.030,
    'fal-ai/ideogram/v3':  0.080,
    'fal-ai/recraft-v3':   0.040,
};

const RATE_LIMIT_DELAY_MS = 2000; // FAL rate-limit koruması — her istek arası 2s

function buildPayload(modelId, prompt, opts = {}) {
    const { seed, referenceImageUrl, negativePrompt } = opts;

    let base;
    if (modelId.includes('ideogram')) {
        base = { prompt, aspect_ratio: '1:1', style_type: 'DESIGN' };
    } else if (modelId.includes('recraft')) {
        base = { prompt, image_size: 'square_hd', style: 'vector_illustration' };
    } else if (modelId.includes('schnell')) {
        base = { prompt, image_size: 'square_hd', num_inference_steps: 4 };
    } else {
        // Flux Dev
        base = {
            prompt,
            image_size:          'square_hd',
            num_inference_steps: 28,
            negative_prompt:     'background, scenery, gradient, blurry, watermark, text-border',
        };
    }

    if (seed !== undefined && seed !== null) base.seed = seed;
    if (referenceImageUrl) base.image_url = referenceImageUrl;

    // StyleProfile'dan gelen negativePrompt mevcut ile birleştirilir
    if (negativePrompt) {
        const existing = base.negative_prompt || '';
        base.negative_prompt = existing ? `${existing}, ${negativePrompt}` : negativePrompt;
    }

    return base;
}

async function processBatch(job) {
    const { batchJobId, workspaceId, niche, engine, images, finalRender } = job.data;
    console.log(`[BatchWorker] ▶ batchJobId:${batchJobId} | ${images.length} görsel | engine:${engine}`);

    const imageRouter = require('../services/providers/image-router');
    const falProvider = require('../services/providers/fal.provider');

    let completed = 0;
    let failed    = 0;

    for (let i = 0; i < images.length; i++) {
        const { imageId, falPrompt, seed, referenceImageUrl, negativePrompt } = images[i];
        const modelId   = engine || 'fal-ai/flux/schnell';
        const modelCost = MODEL_COSTS[modelId] ?? 0.020;

        // Rate-limit koruması — ilk görsel hariç her istekten önce bekle
        if (i > 0) {
            await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS));
        }

        try {
            // ── Üretim ───────────────────────────────────────────────────
            const payload = buildPayload(modelId, falPrompt, { seed, referenceImageUrl, negativePrompt });
            const result  = await imageRouter.generate(modelId, payload, workspaceId);

            // ── RMBG (BiRefNet) ───────────────────────────────────────────
            let finalUrl = result.image_url;
            let rmbgCost = 0;
            try {
                const rmbg = await falProvider.removeBackground(result.image_url, workspaceId);
                finalUrl   = rmbg.image_url;
                rmbgCost   = rmbg.cost || 0;
            } catch (rmbgErr) {
                console.warn(`[BatchWorker] RMBG başarısız (orijinal kullanılıyor): ${rmbgErr.message}`);
            }

            // ── Supabase kalıcı depolama ──────────────────────────────────
            let permanentUrl = finalUrl;
            try {
                const { uploadUrlToStorage } = require('../services/storage.service');
                const storagePath = `batch/${imageId}_${Date.now()}.png`;
                permanentUrl = await uploadUrlToStorage(finalUrl, storagePath);
            } catch (uploadErr) {
                console.warn(`[BatchWorker] Supabase upload başarısız: ${uploadErr.message}`);
            }

            // ── Final Render: AuraSR upscale (≥2048px) ────────────────────
            let upscaleCost = 0;
            if (finalRender) {
                try {
                    const upscaled = await falProvider.upscaleImage(permanentUrl, 2, workspaceId);
                    if (upscaled?.image_url) {
                        permanentUrl = upscaled.image_url;
                        upscaleCost  = upscaled.cost || 0.001;
                        console.log(`[BatchWorker] ↑ Upscale uygulandı | imageId:${imageId}`);
                    }
                } catch (upscaleErr) {
                    console.warn(`[BatchWorker] Upscale başarısız (orijinal kullanılıyor): ${upscaleErr.message}`);
                }
            }

            const totalCost = modelCost + rmbgCost + upscaleCost;

            await prisma.image.update({
                where: { id: imageId },
                data:  {
                    imageUrl: permanentUrl,
                    status:   'COMPLETED',
                    cost:     totalCost,
                    engine:   modelId,
                    seed:     result.seed !== undefined ? String(result.seed) : null,
                },
            });

            recordExpense(workspaceId, {
                imageId,
                jobId:       batchJobId,
                amount:      totalCost,
                provider:    'falai',
                description: `Batch — ${niche} — ${modelId.split('/').pop()}`,
            }).catch(() => {});

            completed++;
            console.log(`[BatchWorker] ✓ ${i + 1}/${images.length} tamamlandı (imageId:${imageId}, $${totalCost.toFixed(4)})`);

        } catch (err) {
            // FAL 429 → exponential backoff ve tekrar dene (worker'ın kendi retry mekanizması var)
            if (err.message?.includes('429') && i < images.length - 1) {
                console.warn(`[BatchWorker] Rate limit (429) — 5s ek bekleme`);
                await new Promise(r => setTimeout(r, 5000));
            }
            console.error(`[BatchWorker] ✗ image ${imageId} başarısız: ${err.message}`);
            await prisma.image.update({
                where: { id: imageId },
                data:  { status: 'FAILED', rawResponse: err.message },
            }).catch(() => {});
            failed++;
        }

        // İlerleme güncelle
        await job.updateProgress(Math.round(((completed + failed) / images.length) * 100));
    }

    // DesignJob durumunu güncelle
    const finalStatus = completed > 0 ? 'COMPLETED' : 'FAILED';
    await prisma.designJob.update({
        where: { id: batchJobId },
        data:  { status: finalStatus },
    });

    console.log(`[BatchWorker] ■ Tamamlandı → ${completed} başarılı, ${failed} başarısız | batchJobId:${batchJobId}`);
    return { completed, failed };
}

const worker = new Worker('batch-generation', processBatch, {
    connection:    redisConnection,
    concurrency:   1,     // batch job sıralı çalışır, paralel değil
    lockDuration:  600_000,  // 10 dk — 20×2s=40s + generation süreleri
    lockRenewTime: 300_000,
});

worker.on('failed', (job, err) => {
    console.error(`[BatchWorker] Job ${job?.id} failed: ${err.message}`);
});

console.log('[BatchWorker] ✔ Dinleniyor → batch-generation (concurrency:1, delay:2s/image)');

// ─── Batch Setup Worker ───────────────────────────────────────────────────────
// Claude varyasyon üretimi + Prisma Image kayıtları + batch-generation kuyruğu
// Bu ağır iş route handler'dan buraya taşındı — proxy timeout sorununu çözer.

const { runBatchSetup } = require('../services/batch-factory.service');

const setupWorker = new Worker('batch-setup', async (job) => {
    const { batchJobId, workspaceId, niche, count, engine, style, mode, ruleContent, ruleTitle } = job.data;
    console.log(`[BatchSetup] ▶ batchJobId:${batchJobId} | mode:${mode} | niche:"${niche || ruleTitle}"`);
    return runBatchSetup(workspaceId, { batchJobId, niche, count, engine, style, mode, ruleContent, ruleTitle });
}, {
    connection:    redisConnection,
    concurrency:   2,
    lockDuration:  120_000,  // 2 dk — Claude API süresi
    lockRenewTime: 60_000,
});

setupWorker.on('failed', (job, err) => {
    console.error(`[BatchSetup] Job ${job?.id} failed: ${err.message}`);
});

console.log('[BatchSetupWorker] ✔ Dinleniyor → batch-setup (concurrency:2)');

module.exports = { worker, setupWorker };
