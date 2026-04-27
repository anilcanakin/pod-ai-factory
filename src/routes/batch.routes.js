const express = require('express');
const router  = express.Router();
const { getBatchStatus, MODEL_REGISTRY } = require('../services/batch-factory.service');
const { getAllPresets }   = require('../services/style-manager.service');
const { batchSetupQueue } = require('../queues/index');
const prisma = require('../lib/prisma');

const BATCH_COST_PER_IMAGE = 0.036;

/**
 * POST /api/batch/generate
 * Body: { niche, count?, engine?, style? }
 * DesignJob hemen oluşturulur, ağır iş (Claude + Prisma) batch-setup kuyruğuna gider.
 * Proxy timeout (ECONNRESET) yok — endpoint <100ms'de cevap verir.
 */
router.post('/generate', async (req, res) => {
    try {
        const { niche, count = 10, engine = 'fal-ai/flux/schnell', style = 'minimalist' } = req.body;
        if (!niche?.trim()) return res.status(400).json({ error: 'niche alanı gerekli' });

        const safeCount = Math.min(Math.max(parseInt(count, 10) || 10, 1), 20);

        const batchJob = await prisma.designJob.create({
            data: {
                workspaceId:   req.workspaceId,
                status:        'PENDING',
                mode:          'batch',
                keyword:       niche.trim(),
                niche:         niche.trim(),
                originalImage: 'batch-mode',
            }
        });

        const queueJob = await batchSetupQueue.add('setup-generate', {
            batchJobId:  batchJob.id,
            workspaceId: req.workspaceId,
            niche:       niche.trim(),
            count:       safeCount,
            engine,
            style,
            mode:        'generate',
        }, {
            attempts: 2,
            backoff:  { type: 'fixed', delay: 5000 },
            removeOnComplete: { count: 50, age: 86400 },
            removeOnFail:     { count: 20, age: 172800 },
        });

        res.json({
            success:       true,
            batchJobId:    batchJob.id,
            queueJobId:    queueJob.id,
            imageCount:    safeCount,
            projectedCost: safeCount * BATCH_COST_PER_IMAGE,
            niche:         niche.trim(),
            engine,
        });
    } catch (err) {
        console.error('[Batch /generate]', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/batch/status/:batchJobId
 * Polling endpoint — ilerleme, completed/failed sayıları, thumbnail URL'leri
 */
router.get('/status/:batchJobId', async (req, res) => {
    try {
        const status = await getBatchStatus(req.params.batchJobId, req.workspaceId);
        if (!status) return res.status(404).json({ error: 'Batch job bulunamadı' });
        res.json({ success: true, ...status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/batch/rules
 * STRATEGIC_RULE tipindeki CorporateMemory kayıtlarını listele.
 */
router.get('/rules', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || 'default-workspace';
        const rules = await prisma.corporateMemory.findMany({
            where: { workspaceId, type: 'STRATEGIC_RULE', isActive: true },
            select: { id: true, title: true, content: true, category: true, createdAt: true,
                      analysisResult: true },
            orderBy: { createdAt: 'desc' },
            take: 50,
        });
        res.json({ success: true, rules });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/batch/from-rule
 * Body: { ruleId, ruleTitle?, ruleContent?, count?, engine?, style? }
 */
router.post('/from-rule', async (req, res) => {
    try {
        const { ruleId, ruleTitle, ruleContent, count = 10, engine = 'fal-ai/flux/schnell', style = 'minimalist' } = req.body;
        if (!ruleId && !ruleContent) {
            return res.status(400).json({ error: 'ruleId veya ruleContent gerekli' });
        }

        let resolvedContent = ruleContent;
        let resolvedTitle   = ruleTitle;

        if (ruleId && !resolvedContent) {
            const mem = await prisma.corporateMemory.findUnique({ where: { id: ruleId } });
            if (!mem) return res.status(404).json({ error: 'Kural bulunamadı' });
            resolvedContent = mem.content;
            resolvedTitle   = ruleTitle || mem.title;
        }

        const safeCount = Math.min(Math.max(parseInt(count, 10) || 10, 1), 20);
        const jobTitle  = (resolvedTitle || 'Rule Batch').slice(0, 100);

        const batchJob = await prisma.designJob.create({
            data: {
                workspaceId:   req.workspaceId,
                status:        'PENDING',
                mode:          'batch',
                keyword:       jobTitle,
                niche:         jobTitle,
                originalImage: 'batch-from-rule',
            }
        });

        const queueJob = await batchSetupQueue.add('setup-from-rule', {
            batchJobId:   batchJob.id,
            workspaceId:  req.workspaceId,
            ruleId,
            ruleTitle:    resolvedTitle,
            ruleContent:  resolvedContent,
            count:        safeCount,
            engine,
            style,
            mode:         'from-rule',
        }, {
            attempts: 2,
            backoff:  { type: 'fixed', delay: 5000 },
            removeOnComplete: { count: 50, age: 86400 },
            removeOnFail:     { count: 20, age: 172800 },
        });

        res.json({
            success:       true,
            batchJobId:    batchJob.id,
            queueJobId:    queueJob.id,
            imageCount:    safeCount,
            projectedCost: safeCount * BATCH_COST_PER_IMAGE,
            ruleTitle:     resolvedTitle,
            engine,
        });
    } catch (err) {
        console.error('[Batch /from-rule]', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/batch/draft
 * Body: { niche, designBrief, productType?, ideaTitle? }
 * 2 taslak görsel (Flux Schnell) — Claude çağrısı yok, <50ms cevap.
 */
router.post('/draft', async (req, res) => {
    try {
        const { niche, designBrief, productType, ideaTitle, seed, referenceImageUrl, stylePresetId, styleProfileId } = req.body;
        if (!designBrief?.trim()) return res.status(400).json({ error: 'designBrief gerekli' });

        const parsedSeed = seed !== undefined && seed !== null ? parseInt(seed, 10) || undefined : undefined;

        const batchJob = await prisma.designJob.create({
            data: {
                workspaceId:   req.workspaceId,
                status:        'PENDING',
                mode:          'batch',
                keyword:       (ideaTitle || niche || 'draft').slice(0, 100),
                niche:         (niche || 'draft').slice(0, 100),
                originalImage: 'batch-draft',
            }
        });

        const queueJob = await batchSetupQueue.add('setup-draft', {
            batchJobId:        batchJob.id,
            workspaceId:       req.workspaceId,
            niche:             (niche || 'draft').slice(0, 100),
            designBrief:       designBrief.trim(),
            ideaTitle:         ideaTitle   || null,
            stylePresetId:     stylePresetId  || null,
            styleProfileId:    styleProfileId || null,
            seed:              parsedSeed,
            referenceImageUrl: referenceImageUrl || null,
            mode:              'draft',
        }, {
            attempts: 2,
            backoff:  { type: 'fixed', delay: 5000 },
            removeOnComplete: { count: 50, age: 86400 },
            removeOnFail:     { count: 20, age: 172800 },
        });

        res.json({
            success:    true,
            batchJobId: batchJob.id,
            queueJobId: queueJob.id,
            imageCount: 2,
            niche:      niche || 'draft',
        });
    } catch (err) {
        console.error('[Batch /draft]', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/batch/final-render
 * Body: { designBrief, modelKey, niche?, variantLabel?, draftImageId? }
 * Model bazlı optimize edilmiş 1 final görsel + AuraSR upscale.
 */
router.post('/final-render', async (req, res) => {
    try {
        const { draftImageId, modelKey, designBrief, niche, variantLabel, seed, stylePresetId, styleProfileId } = req.body;
        if (!designBrief?.trim())       return res.status(400).json({ error: 'designBrief gerekli' });
        if (!MODEL_REGISTRY[modelKey])  return res.status(400).json({ error: `Geçersiz modelKey. Kabul edilenler: ${Object.keys(MODEL_REGISTRY).filter(k => k !== 'DRAFT').join(', ')}` });

        const model      = MODEL_REGISTRY[modelKey];
        const parsedSeed = seed !== undefined && seed !== null ? parseInt(seed, 10) || undefined : undefined;

        const batchJob = await prisma.designJob.create({
            data: {
                workspaceId:   req.workspaceId,
                status:        'PENDING',
                mode:          'batch',
                keyword:       (niche || 'final-render').slice(0, 100),
                niche:         (niche || 'final-render').slice(0, 100),
                originalImage: draftImageId || 'batch-final',
            }
        });

        const queueJob = await batchSetupQueue.add('setup-final', {
            batchJobId:     batchJob.id,
            workspaceId:    req.workspaceId,
            niche:          (niche || 'final').slice(0, 100),
            designBrief:    designBrief.trim(),
            modelKey,
            variantLabel:   variantLabel || model.label,
            stylePresetId:  stylePresetId  || null,
            styleProfileId: styleProfileId || null,
            seed:           parsedSeed,
            mode:           'final',
        }, {
            attempts: 2,
            backoff:  { type: 'fixed', delay: 5000 },
            removeOnComplete: { count: 50, age: 86400 },
            removeOnFail:     { count: 20, age: 172800 },
        });

        res.json({
            success:       true,
            batchJobId:    batchJob.id,
            queueJobId:    queueJob.id,
            imageCount:    1,
            projectedCost: model.cost,
            modelKey,
            modelLabel:    model.label,
        });
    } catch (err) {
        console.error('[Batch /final-render]', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/batch/styles
 * Tüm stil preset'lerini döner (frontend chip selector için).
 */
router.get('/styles', (req, res) => {
    try {
        res.json({ success: true, presets: getAllPresets() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
