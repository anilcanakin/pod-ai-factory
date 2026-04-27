/**
 * batch-factory.service.js — Industrial Mode (Toplu Üretim)
 *
 * Bir winner niş → Claude Sonnet → N varyasyon (slogan + FAL prompt + SEO)
 * → DesignJob + Image kayıtları → batch-generation kuyruğu
 * → Projected maliyet anında FinanceService'e kaydedilir
 */

const Anthropic = require('@anthropic-ai/sdk');
const { Queue } = require('bullmq');
const redisConnection = require('../config/redis');
const { recordExpense } = require('./finance.service');

const prisma = require('../lib/prisma');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const BATCH_COST_PER_IMAGE = 0.036;  // FAL Schnell + BiRefNet RMBG tahmini

// ─── Model Registry ───────────────────────────────────────────────────────────

const MODEL_REGISTRY = {
    DRAFT:          { id: 'fal-ai/flux/schnell',               label: 'Taslak — Flux Schnell',     cost: 0.003 },
    PREMIUM_GOOGLE: { id: 'fal-ai/nano-banana-2',              label: 'Nano Banana 2',             cost: 0.060 },
    PREMIUM_OPENAI: { id: 'openai/gpt-image-2',                label: 'GPT Image 2',               cost: 0.080 },
    PREMIUM_SD:     { id: 'fal-ai/stable-diffusion-v3-medium', label: 'Stable Diffusion v3',       cost: 0.040 },
};

function refinePromptForModel(basePrompt, modelKey) {
    switch (modelKey) {
        case 'PREMIUM_SD':
            return `${basePrompt}, vector illustration, clean geometric lines, flat design, pure white background, t-shirt print ready, high contrast, no gradients, no photorealistic, ((crisp clean edges)), scalable graphic, bold outlines`;
        case 'PREMIUM_GOOGLE':
            return `${basePrompt}, high detail, artistic masterpiece, vibrant balanced colors, beautiful aesthetic composition, professional print design, elegant visual hierarchy, ultra quality`;
        case 'PREMIUM_OPENAI':
            return `${basePrompt}, highly detailed semantic design, rich visual storytelling, professional artwork, expressive artistic style, clear strong focal point, print-ready with clean background`;
        default:
            return basePrompt; // DRAFT — no refinement needed
    }
}

const STYLE_GUIDES = {
    minimalist:   'clean, simple, bold typography, generous white space, flat design',
    retro:        'vintage, distressed texture, warm retro color palette, aged look',
    bold:         'high contrast, strong vibrant colors, heavy impact typography',
    funny:        'playful, humorous, cartoon-like elements, fun and lighthearted',
    motivational: 'uplifting, energetic, inspirational feel, dynamic composition',
};

// ─── Variation Generator ──────────────────────────────────────────────────────

async function generateVariations(niche, count, style) {
    const styleGuide = STYLE_GUIDES[style] || 'clean, versatile, print-ready';

    const prompt = `You are an expert Etsy POD designer and copywriter. Generate exactly ${count} UNIQUE design variations for the niche: "${niche}".

Each variation must have a clearly different angle: different slogan tone, different visual composition, different sub-audience.

Style: ${styleGuide}

For each variation produce:
1. slogan — punchy main text (max 8 words), print-ready
2. visualComposition — brief layout description (1 sentence)
3. falPrompt — detailed FAL.ai generation prompt: white/transparent background, printable, vector-clean, high contrast, no photorealistic background, suitable for t-shirt/mug print
4. seo — Etsy listing package:
   • title (max 130 chars, include main keyword near start)
   • description (2 engaging sentences)
   • tags (exactly 13 tags, array of strings, max 20 chars each)

STRICT JSON only — no markdown, no extra text:
{"variations":[{"slogan":"...","visualComposition":"...","falPrompt":"...","seo":{"title":"...","description":"...","tags":["tag1","tag2","tag3","tag4","tag5","tag6","tag7","tag8","tag9","tag10","tag11","tag12","tag13"]}}]}`;

    const res = await anthropic.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 8000,
        messages:   [{ role: 'user', content: prompt }],
    });

    const raw = res.content[0].text.replace(/```json/gi, '').replace(/```/g, '').trim();

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (_) {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) {
            try { parsed = JSON.parse(m[0]); } catch (_2) { return []; }
        } else return [];
    }

    return (parsed.variations || []).filter(v => v?.falPrompt && v?.slogan);
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

async function createBatchRun(workspaceId, { niche, count = 10, engine = 'fal-ai/flux/schnell', style = 'minimalist' }) {
    count = Math.min(Math.max(parseInt(count, 10), 1), 20);

    // Step 1: Claude Sonnet → varyasyonlar
    console.log(`[BatchFactory] Claude varyasyon üretimi başlıyor → niche:"${niche}", count:${count}, style:${style}`);
    const variations = await generateVariations(niche, count, style);
    if (!variations.length) throw new Error('Claude varyasyon üretemedi — nişi biraz daha açıklayın');

    // Step 2: DesignJob oluştur
    const batchJob = await prisma.designJob.create({
        data: {
            workspaceId,
            status:        'PROCESSING',
            mode:          'batch',
            keyword:       niche,
            niche,
            originalImage: 'batch-mode',
        }
    });
    console.log(`[BatchFactory] DesignJob oluşturuldu → ${batchJob.id}`);

    // Step 3: Her varyasyon için Image + SEOData
    const queueItems = [];
    for (const v of variations) {
        let img;
        try {
            img = await prisma.image.create({
                data: {
                    jobId:       batchJob.id,
                    engine,
                    promptUsed:  v.falPrompt,
                    variantType: v.slogan?.slice(0, 50) || style,
                    imageUrl:    'PENDING',
                    status:      'GENERATED',
                    cost:        0,
                    isApproved:  false,
                }
            });
        } catch (err) {
            console.error(`[BatchFactory] Image.create hatası, atlanıyor → ${err.message}`);
            continue;
        }

        if (v.seo) {
            try {
                const tags = Array.isArray(v.seo.tags)
                    ? v.seo.tags.map(t => String(t).slice(0, 20)).slice(0, 13)
                    : [];
                await prisma.sEOData.upsert({
                    where:  { imageId: img.id },
                    create: { imageId: img.id, title: v.seo.title || '', description: v.seo.description || '', tags },
                    update: { title: v.seo.title || '', description: v.seo.description || '', tags },
                });
            } catch (_) {}
        }

        queueItems.push({
            imageId:           img.id,
            falPrompt:         v.falPrompt,
            slogan:            v.slogan,
            visualComposition: v.visualComposition,
            engine,
        });
    }

    if (!queueItems.length) {
        throw new Error('Tüm Image kayıtları oluşturulamadı — Prisma hatalarını kontrol edin');
    }

    // Step 4: Projected maliyet — anında Daily Spend'e yansıt
    const projectedCost = queueItems.length * BATCH_COST_PER_IMAGE;
    recordExpense(workspaceId, {
        jobId:       batchJob.id,
        amount:      projectedCost,
        provider:    'falai',
        description: `Industrial Batch (${queueItems.length}× ${engine.split('/').pop()}) — ${niche}`,
    }).catch(() => {});

    // Step 5: Kuyruğa gönder
    const batchQueue = new Queue('batch-generation', { connection: redisConnection });
    const queueJob = await batchQueue.add('process-batch', {
        batchJobId:  batchJob.id,
        workspaceId,
        niche,
        engine,
        images:      queueItems,
    }, {
        attempts: 2,
        backoff:  { type: 'fixed', delay: 10000 },
        removeOnComplete: { count: 100, age: 86400 },
        removeOnFail:     { count: 50,  age: 172800 },
    });

    console.log(`[BatchFactory] ✓ Kuyruğa eklendi → queueJobId:${queueJob.id}, images:${queueItems.length}, projectedCost:$${projectedCost.toFixed(3)}`);

    return {
        batchJobId:    batchJob.id,
        queueJobId:    queueJob.id,
        imageCount:    queueItems.length,
        projectedCost,
        niche,
        engine,
    };
}

// ─── Status Polling ───────────────────────────────────────────────────────────

async function getBatchStatus(batchJobId, workspaceId) {
    const job = await prisma.designJob.findFirst({
        where:   { id: batchJobId, workspaceId },
        include: {
            images: {
                select: { id: true, status: true, imageUrl: true, cost: true, promptUsed: true, seed: true },
                orderBy: { createdAt: 'asc' },
            }
        },
    });
    if (!job) return null;

    const total     = job.images.length;
    const completed = job.images.filter(i => i.status === 'COMPLETED').length;
    const failed    = job.images.filter(i => i.status === 'FAILED').length;
    const pending   = total - completed - failed;
    const totalCost = job.images.reduce((s, i) => s + (i.cost || 0), 0);

    return {
        batchJobId,
        status:   job.status,
        niche:    job.niche,
        total,
        completed,
        failed,
        pending,
        progress: total > 0 ? Math.round((completed / total) * 100) : 0,
        totalCost,
        images: job.images.map(i => ({
            id:        i.id,
            status:    i.status,
            imageUrl:  i.imageUrl !== 'PENDING' ? i.imageUrl : null,
            slogan:    i.promptUsed?.split('\n')[0]?.slice(0, 60) || '',
            seed:      i.seed || null,
        })),
    };
}

// ─── Rule-Based Batch ─────────────────────────────────────────────────────────

/**
 * Bir STRATEGIC_RULE metnini kullanarak batch run oluştur.
 * createBatchRun ile aynı flow — sadece prompt farklı.
 */
async function generateVariationsFromRule(ruleContent, count, style) {
    const styleGuide = STYLE_GUIDES[style] || 'clean, versatile, print-ready';

    const prompt = `You are an expert Etsy POD t-shirt designer. Generate exactly ${count} UNIQUE t-shirt design variations based on the following strategic business rule.

STRATEGIC RULE:
${ruleContent.slice(0, 2000)}

Each variation must target a different angle: different slogan tone, niche audience, or visual approach — all rooted in the rule above.
Style guide for this batch: ${styleGuide}

For each variation return:
1. slogan — punchy main text (max 8 words), print-ready
2. visualComposition — brief layout description (1 sentence)
3. falPrompt — detailed FAL.ai generation prompt: white/transparent background, printable, vector-clean, high contrast, no photorealistic background, t-shirt print ready
4. seo — Etsy listing package:
   • title (max 130 chars)
   • description (2 engaging sentences)
   • tags (exactly 13 tags, array of strings, max 20 chars each)

STRICT JSON only — no markdown, no extra text:
{"variations":[{"slogan":"...","visualComposition":"...","falPrompt":"...","seo":{"title":"...","description":"...","tags":["tag1","tag2","tag3","tag4","tag5","tag6","tag7","tag8","tag9","tag10","tag11","tag12","tag13"]}}]}`;

    const res = await anthropic.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 8000,
        messages:   [{ role: 'user', content: prompt }],
    });

    const raw = res.content[0].text.replace(/```json/gi, '').replace(/```/g, '').trim();
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (_) {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) {
            try { parsed = JSON.parse(m[0]); } catch (_2) { return []; }
        } else return [];
    }

    return (parsed.variations || []).filter(v => v?.falPrompt && v?.slogan);
}

async function createBatchRunFromRule(workspaceId, { ruleId, ruleTitle = 'Batch Run', ruleContent, count = 10, engine = 'fal-ai/flux/schnell', style = 'minimalist' }) {
    count = Math.min(Math.max(parseInt(count, 10), 1), 20);

    console.log(`[BatchFactory] Rule-based batch → ruleId:${ruleId}, count:${count}, style:${style}`);
    const variations = await generateVariationsFromRule(ruleContent, count, style);
    if (!variations.length) throw new Error('Claude varyasyon üretemedi — kural içeriğini kontrol edin');

    const batchJob = await prisma.designJob.create({
        data: {
            workspaceId,
            status:        'PROCESSING',
            mode:          'batch',
            keyword:       ruleTitle.slice(0, 100),
            niche:         ruleTitle.slice(0, 100),
            originalImage: 'batch-from-rule',
        }
    });

    const queueItems = [];
    for (const v of variations) {
        let img;
        try {
            img = await prisma.image.create({
                data: {
                    jobId:       batchJob.id,
                    engine,
                    promptUsed:  v.falPrompt,
                    variantType: v.slogan?.slice(0, 50) || style,
                    imageUrl:    'PENDING',
                    status:      'GENERATED',
                    cost:        0,
                    isApproved:  false,
                }
            });
        } catch (err) {
            console.error(`[BatchFactory] Rule-batch Image.create hatası, atlanıyor → ${err.message}`);
            continue;
        }

        if (v.seo) {
            try {
                const tags = Array.isArray(v.seo.tags)
                    ? v.seo.tags.map(t => String(t).slice(0, 20)).slice(0, 13)
                    : [];
                await prisma.sEOData.upsert({
                    where:  { imageId: img.id },
                    create: { imageId: img.id, title: v.seo.title || '', description: v.seo.description || '', tags },
                    update: { title: v.seo.title || '', description: v.seo.description || '', tags },
                });
            } catch (_) {}
        }

        queueItems.push({ imageId: img.id, falPrompt: v.falPrompt, slogan: v.slogan, engine });
    }

    if (!queueItems.length) {
        throw new Error('Tüm Image kayıtları oluşturulamadı — Prisma hatalarını kontrol edin');
    }

    const projectedCost = queueItems.length * BATCH_COST_PER_IMAGE;
    recordExpense(workspaceId, {
        jobId:       batchJob.id,
        amount:      projectedCost,
        provider:    'falai',
        description: `Rule Batch (${queueItems.length}× ${engine.split('/').pop()}) — ${ruleTitle}`,
    }).catch(() => {});

    const batchQueue = new Queue('batch-generation', { connection: redisConnection });
    const queueJob = await batchQueue.add('process-batch', {
        batchJobId:  batchJob.id,
        workspaceId,
        niche:       ruleTitle,
        engine,
        images:      queueItems,
    }, {
        attempts: 2,
        backoff:  { type: 'fixed', delay: 10000 },
        removeOnComplete: { count: 100, age: 86400 },
        removeOnFail:     { count: 50,  age: 172800 },
    });

    console.log(`[BatchFactory] ✓ Rule batch kuyruğa eklendi → ${queueJob.id}, ${queueItems.length} görsel, $${projectedCost.toFixed(3)}`);

    return {
        batchJobId:    batchJob.id,
        queueJobId:    queueJob.id,
        imageCount:    queueItems.length,
        projectedCost,
        ruleTitle,
        engine,
    };
}

// ─── Async Setup (queue worker entry point) ───────────────────────────────────

async function _createImageRecord(batchJobId, engine, prompt, variantType) {
    return prisma.image.create({
        data: {
            jobId:       batchJobId,
            engine,
            promptUsed:  prompt,
            variantType: (variantType || engine.split('/').pop()).slice(0, 50),
            imageUrl:    'PENDING',
            status:      'GENERATED',
            cost:        0,
            isApproved:  false,
        }
    });
}

async function _queueForGeneration(batchJobId, workspaceId, niche, engine, queueItems, finalRender = false) {
    const batchQueue = new Queue('batch-generation', { connection: redisConnection });
    return batchQueue.add('process-batch', {
        batchJobId, workspaceId, niche, engine, images: queueItems, finalRender,
    }, {
        attempts:  2,
        backoff:   { type: 'fixed', delay: 10000 },
        removeOnComplete: { count: 100, age: 86400 },
        removeOnFail:     { count: 50,  age: 172800 },
    });
}

/**
 * mode: 'draft'   — 2 hızlı Flux Schnell taslak (Claude çağrısı yok)
 * mode: 'final'   — refine edilmiş prompt ile 1 premium görsel + upscale
 * mode: 'generate' / 'from-rule' — mevcut Claude varyasyon akışı
 *
 * Opsiyonel stil parametreleri:
 *   stylePresetId    — style-manager.service.js'den bir preset ID'si
 *   seed             — FAL.ai deterministik seed (int)
 *   referenceImageUrl — style reference görseli (draft modunda image_url olarak geçer)
 */
async function runBatchSetup(workspaceId, { batchJobId, niche, count, engine, style, mode, ruleContent, ruleTitle, designBrief, modelKey, variantLabel, stylePresetId, styleProfileId, seed, referenceImageUrl, ideaTitle }) {
    const { applyStylePreset }   = require('./style-manager.service');
    const { applyToJobContext }  = require('./style.service');
    const { buildSloganInstruction } = require('./style.service');

    // ── Stil çözümleme ────────────────────────────────────────────────────────
    // styleProfileId > stylePresetId — sadece birini uygula
    let resolvedRefUrl  = referenceImageUrl || null;
    let resolvedNegPmt  = null;

    if (styleProfileId) {
        const ctx = await applyToJobContext(workspaceId, {
            styleProfileId,
            basePrompt: designBrief || '',
            slogan:     ideaTitle   || '',
        });
        // ctx.finalPrompt sadece draft/final'da kullanılır; generate'de her varyasyon ayrı işlenir
        resolvedRefUrl = ctx.referenceImageUrl || resolvedRefUrl;
        resolvedNegPmt = ctx.negativePrompt    || null;
    }

    // ── DRAFT MODE ────────────────────────────────────────────────────────────
    if (mode === 'draft') {
        const draftEngine = MODEL_REGISTRY.DRAFT.id;

        // Temel prompt: designBrief + slogan talimatı
        let basePrompt = `${designBrief}, print on demand design, white background, clean flat graphic, t-shirt ready, high contrast`;

        // Slogan enjeksiyonu (ideaTitle = slogan/başlık)
        if (ideaTitle) {
            const sloganInstruction = buildSloganInstruction(ideaTitle);
            if (sloganInstruction) basePrompt = `${basePrompt}, ${sloganInstruction}`;
        }

        // Stil enjeksiyonu
        if (styleProfileId) {
            const ctx = await applyToJobContext(workspaceId, { styleProfileId, basePrompt, slogan: ideaTitle });
            basePrompt = ctx.finalPrompt;
        } else if (stylePresetId) {
            basePrompt = applyStylePreset(basePrompt, stylePresetId);
        }

        await prisma.designJob.update({ where: { id: batchJobId }, data: { status: 'PROCESSING' } });

        const queueItems = [];
        for (let i = 0; i < 2; i++) {
            try {
                const img = await _createImageRecord(batchJobId, draftEngine, basePrompt, `${(niche || 'draft').slice(0, 25)}-v${i + 1}`);
                queueItems.push({
                    imageId:           img.id,
                    falPrompt:         basePrompt,
                    engine:            draftEngine,
                    seed:              seed              || null,
                    referenceImageUrl: resolvedRefUrl    || null,
                    negativePrompt:    resolvedNegPmt    || null,
                });
            } catch (err) {
                console.error(`[BatchSetup/draft] Image.create hatası → ${err.message}`);
            }
        }

        if (!queueItems.length) {
            await prisma.designJob.update({ where: { id: batchJobId }, data: { status: 'FAILED' } });
            throw new Error('Draft Image kayıtları oluşturulamadı');
        }

        await _queueForGeneration(batchJobId, workspaceId, niche || 'draft', draftEngine, queueItems, false);
        console.log(`[BatchSetup] ✓ Draft kuyruğa eklendi | 2 görsel | batchJobId:${batchJobId}${stylePresetId ? ` | preset:${stylePresetId}` : ''}${styleProfileId ? ` | profile:${styleProfileId}` : ''}`);
        return { imageCount: queueItems.length, projectedCost: queueItems.length * MODEL_REGISTRY.DRAFT.cost };
    }

    // ── FINAL RENDER MODE ─────────────────────────────────────────────────────
    if (mode === 'final') {
        const model = MODEL_REGISTRY[modelKey] || MODEL_REGISTRY.PREMIUM_GOOGLE;

        let refinedPrompt = refinePromptForModel(designBrief, modelKey);

        // Slogan enjeksiyonu
        if (ideaTitle) {
            const sloganInstruction = buildSloganInstruction(ideaTitle);
            if (sloganInstruction) refinedPrompt = `${refinedPrompt}, ${sloganInstruction}`;
        }

        // Stil enjeksiyonu
        if (styleProfileId) {
            const ctx = await applyToJobContext(workspaceId, { styleProfileId, basePrompt: refinedPrompt, slogan: ideaTitle });
            refinedPrompt  = ctx.finalPrompt;
            resolvedRefUrl = ctx.referenceImageUrl || resolvedRefUrl;
            resolvedNegPmt = ctx.negativePrompt    || null;
        } else if (stylePresetId) {
            refinedPrompt = applyStylePreset(refinedPrompt, stylePresetId);
        }

        await prisma.designJob.update({ where: { id: batchJobId }, data: { status: 'PROCESSING' } });

        let img;
        try {
            img = await _createImageRecord(batchJobId, model.id, refinedPrompt, variantLabel || model.label);
        } catch (err) {
            await prisma.designJob.update({ where: { id: batchJobId }, data: { status: 'FAILED' } });
            throw new Error(`Final Image.create hatası: ${err.message}`);
        }

        recordExpense(workspaceId, {
            jobId:       batchJobId,
            amount:      model.cost,
            provider:    'falai',
            description: `Final Render — ${model.label} — ${niche}`,
        }).catch(() => {});

        await _queueForGeneration(batchJobId, workspaceId, niche || 'final', model.id,
            [{ imageId: img.id, falPrompt: refinedPrompt, engine: model.id, seed: seed || null,
               referenceImageUrl: resolvedRefUrl, negativePrompt: resolvedNegPmt }], true);

        console.log(`[BatchSetup] ✓ Final render kuyruğa eklendi | ${model.label} | batchJobId:${batchJobId}`);
        return { imageCount: 1, projectedCost: model.cost };
    }

    // ── GENERATE / FROM-RULE (existing flow) ──────────────────────────────────
    count = Math.min(Math.max(parseInt(count, 10), 1), 20);

    let variations;
    if (mode === 'from-rule') {
        variations = await generateVariationsFromRule(ruleContent, count, style);
    } else {
        variations = await generateVariations(niche, count, style);
    }

    if (!variations.length) {
        await prisma.designJob.update({ where: { id: batchJobId }, data: { status: 'FAILED' } });
        throw new Error('Claude varyasyon üretemedi');
    }

    await prisma.designJob.update({ where: { id: batchJobId }, data: { status: 'PROCESSING' } });

    const queueItems = [];
    for (const v of variations) {
        let img;
        try {
            img = await _createImageRecord(batchJobId, engine, v.falPrompt, v.slogan?.slice(0, 50) || style);
        } catch (err) {
            console.error(`[BatchSetup] Image.create hatası, atlanıyor → ${err.message}`);
            continue;
        }

        if (v.seo) {
            try {
                const tags = Array.isArray(v.seo.tags)
                    ? v.seo.tags.map(t => String(t).slice(0, 20)).slice(0, 13)
                    : [];
                await prisma.sEOData.upsert({
                    where:  { imageId: img.id },
                    create: { imageId: img.id, title: v.seo.title || '', description: v.seo.description || '', tags },
                    update: { title: v.seo.title || '', description: v.seo.description || '', tags },
                });
            } catch (_) {}
        }

        queueItems.push({ imageId: img.id, falPrompt: v.falPrompt, slogan: v.slogan, visualComposition: v.visualComposition, engine });
    }

    if (!queueItems.length) {
        await prisma.designJob.update({ where: { id: batchJobId }, data: { status: 'FAILED' } });
        throw new Error('Hiç Image kaydı oluşturulamadı — Prisma hatalarını kontrol edin');
    }

    const projectedCost = queueItems.length * BATCH_COST_PER_IMAGE;
    recordExpense(workspaceId, {
        jobId:       batchJobId,
        amount:      projectedCost,
        provider:    'falai',
        description: `Industrial Batch (${queueItems.length}× ${engine.split('/').pop()}) — ${niche || ruleTitle}`,
    }).catch(() => {});

    await _queueForGeneration(batchJobId, workspaceId, niche || ruleTitle, engine, queueItems, false);

    console.log(`[BatchSetup] ✓ ${queueItems.length} görsel kuyruğa eklendi | batchJobId:${batchJobId}`);
    return { imageCount: queueItems.length, projectedCost };
}

module.exports = { createBatchRun, getBatchStatus, generateVariations, generateVariationsFromRule, createBatchRunFromRule, runBatchSetup, MODEL_REGISTRY, refinePromptForModel };
