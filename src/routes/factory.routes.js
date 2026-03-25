const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const visionService = require('../services/vision.service');
const generationService = require('../services/generation.service');
const logService = require('../services/log.service');
const usageMiddleware = require('../config/usage.middleware');

const prisma = new PrismaClient();

// Helper: mark job FAILED and log the failure
async function failJob(jobId, step, err) {
    const msg = err?.message || String(err);
    await Promise.allSettled([
        prisma.designJob.update({ where: { id: jobId }, data: { status: 'FAILED' } }),
        logService.logEvent(jobId, step, 'FAILED', msg)
    ]);
}

// ── Helper: check if OpenAI vision is available ────────────────
function isVisionEnabled() {
    return process.env.USE_VISION === 'true'
        && process.env.OPENAI_API_KEY
        && process.env.OPENAI_API_KEY.length > 10
        && process.env.OPENAI_API_KEY !== 'your_openai_api_key';
}

// ────────────────────────────────────────────────────────────────
// GET /api/factory/models
// Get list of supported AI models for image generation
// ────────────────────────────────────────────────────────────────
router.get('/models', (req, res) => {
    try {
        const models = generationService.SUPPORTED_MODELS || {};
        res.json(Object.entries(models).map(([id, info]) => ({
            id,
            ...info
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ────────────────────────────────────────────────────────────────
// POST /api/factory/analyze
// Analyze reference image(s) via Vision API → return generation prompt
// ────────────────────────────────────────────────────────────────
router.post('/analyze', usageMiddleware, async (req, res) => {
    try {
        const { referenceImageIds } = req.body;
        if (!referenceImageIds || !Array.isArray(referenceImageIds) || referenceImageIds.length === 0) {
            return res.status(400).json({ error: 'referenceImageIds is required (array of image URLs or base64).' });
        }

        const workspaceId = req.workspaceId;
        if (!workspaceId) return res.status(401).json({ error: 'Authentication required.' });

        // Frontend sends Data URLs: data:image/jpeg;base64,/9j/4AAQSk...
        const dataUrl = referenceImageIds[0] || '';
        let base64Data = dataUrl;
        let mimeType = 'image/jpeg';

        if (dataUrl.startsWith('data:')) {
            const matches = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                mimeType = matches[1];
                base64Data = matches[2];
            }
        }

        // Call multi-provider vision service
        const result = await visionService.analyzeImage(base64Data, mimeType);
        
        res.json(result);
    } catch (err) {
        console.error('[Factory Analyze]', err);
        res.status(500).json({ error: err.message });
    }
});

// ────────────────────────────────────────────────────────────────
// POST /api/factory/get-variations
// Generate N prompt variations from a base prompt
// ────────────────────────────────────────────────────────────────
router.post('/get-variations', usageMiddleware, async (req, res) => {
    try {
        const { basePrompt, count = 4, variationMode = 'subject' } = req.body;
        if (!basePrompt) return res.status(400).json({ error: 'basePrompt is required.' });

        const clampedCount = Math.min(Math.max(parseInt(count) || 4, 1), 8);
        const validModes = ['subject', 'style', 'color'];
        const mode = validModes.includes(variationMode) ? variationMode : 'subject';

        const workspaceId = req.workspaceId;
        if (!workspaceId) return res.status(401).json({ error: 'Authentication required.' });

        if (!isVisionEnabled()) {
            // Synthetic variations — deterministic text manipulation
            const modeSwaps = {
                subject: ['wolf', 'eagle', 'skull with roses', 'bear', 'lion', 'shark', 'dragon', 'phoenix'],
                style: ['vintage distressed', 'minimalist line art', 'neon cyberpunk', 'watercolor soft', 'bold retro', 'grunge punk', 'kawaii cute', 'art deco'],
                color: ['navy and gold', 'red and black', 'pastel pink and white', 'forest green and cream', 'sunset orange and purple', 'teal and coral', 'monochrome grayscale', 'electric blue and yellow']
            };

            const swaps = modeSwaps[mode];
            const variations = [];
            for (let i = 0; i < clampedCount; i++) {
                const swap = swaps[i % swaps.length];
                if (mode === 'subject') {
                    variations.push(basePrompt.replace(/(?:of a |of an )[\w\s]+(?:\.|\,)/i, `of a ${swap}.`));
                } else if (mode === 'style') {
                    variations.push(`${basePrompt} Reimagined in ${swap} aesthetic.`);
                } else {
                    variations.push(`${basePrompt} Using a ${swap} color palette.`);
                }
            }

            return res.json({ variations });
        }

        // Real AI variations
        const result = await visionService.getVariations(basePrompt, clampedCount, mode);
        res.json(result);
    } catch (err) {
        console.error('[Factory Get Variations]', err);
        res.status(500).json({ error: err.message });
    }
});

// ────────────────────────────────────────────────────────────────
// POST /api/factory/generate
// Take prompt list, create Image records, queue Fal.ai generation
// ────────────────────────────────────────────────────────────────
router.post('/generate', usageMiddleware, async (req, res) => {
    let jobId = null;
    try {
        const { prompts, model = 'fal-ai/flux/dev', imageSize = 'square_hd' } = req.body;

        if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
            return res.status(400).json({ error: 'prompts must be a non-empty array of strings.' });
        }

        const workspaceId = req.workspaceId;
        if (!workspaceId) return res.status(401).json({ error: 'Authentication required.' });

        // Check concurrent job cap
        const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
        if (!workspace) return res.status(403).json({ error: 'Invalid workspace context.' });

        const cap = workspace.concurrentJobCap || parseInt(process.env.CONCURRENT_JOB_CAP || '2', 10);
        const activeJobs = await prisma.designJob.count({
            where: { workspaceId, status: 'PROCESSING' }
        });
        if (activeJobs >= cap) {
            return res.status(429).json({ error: `Concurrent Job Limit Reached: Maximum ${cap} active jobs allowed.` });
        }

        // 1. Create Job
        const job = await prisma.designJob.create({
            data: {
                originalImage: 'prompt-based-generation',
                status: 'PROCESSING',
                workspaceId,
                basePrompt: prompts[0] // Store first prompt as base
            }
        });
        jobId = job.id;
        await logService.logEvent(jobId, 'FACTORY_GENERATION_START', 'SUCCESS', `Starting generation of ${prompts.length} images.`);

        // 2. Create Image records (PENDING)
        for (const prompt of prompts) {
            await prisma.image.create({
                data: {
                    jobId,
                    variantType: 'prompt_based',
                    promptUsed: prompt,
                    engine: model,
                    imageUrl: 'PENDING',
                    status: 'GENERATED'
                }
            });
        }
        await logService.logEvent(jobId, 'VARIATIONS_CREATED', 'SUCCESS', `Created ${prompts.length} image records.`);

        // 3. Start generation (uses existing generationService)
        try {
            await generationService.runGeneration(jobId, 'fal', prompts.length, imageSize);
            await logService.logEvent(jobId, 'GENERATION_DONE', 'SUCCESS', 'All images generated.');
        } catch (err) {
            await logService.logEvent(jobId, 'GENERATION_DONE', 'FAILED', err.message);
            await failJob(jobId, 'GENERATION_FATAL', err);
            return res.status(500).json({ error: `Generation failed: ${err.message}`, jobId });
        }

        // 4. Mark COMPLETED
        await prisma.designJob.update({ where: { id: jobId }, data: { status: 'COMPLETED' } });
        await logService.logEvent(jobId, 'FACTORY_RUN_DONE', 'SUCCESS', 'Generation pipeline completed.');

        res.json({
            jobId,
            imageCount: prompts.length,
            message: 'Generation started'
        });

    } catch (err) {
        console.error('[Factory Generate]', err);
        if (jobId) await failJob(jobId, 'FACTORY_GENERATION_ERROR', err).catch(() => { });
        res.status(500).json({ error: err.message, jobId });
    }
});

// ────────────────────────────────────────────────────────────────
// POST /api/factory/retry/:jobId
// ────────────────────────────────────────────────────────────────
router.post('/retry/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = await prisma.designJob.findUnique({ where: { id: jobId, workspaceId: req.workspaceId } });

        if (!job) return res.status(404).json({ error: 'Job not found' });
        if (job.status !== 'FAILED') return res.status(400).json({ error: 'Only FAILED jobs can be retried' });

        await prisma.designJob.update({ where: { id: jobId }, data: { status: 'PROCESSING' } });
        res.json({ message: 'Job reset to PROCESSING mode.', jobId });
    } catch (err) {
        console.error('[Factory Retry]', err);
        res.status(500).json({ error: err.message });
    }
});

// ────────────────────────────────────────────────────────────────
// POST /api/factory/etsy-mode — Full Etsy Seller Mode
// ────────────────────────────────────────────────────────────────
router.post('/etsy-mode', usageMiddleware, async (req, res) => {
    try {
        const { keyword, niche, style, designCount = 20 } = req.body;
        if (!keyword) return res.status(400).json({ error: 'keyword is required for Etsy Mode.' });

        const workspaceId = req.workspaceId;
        if (!workspaceId) return res.status(401).json({ error: 'Authentication required.' });

        const etsyModeService = require('../services/etsy-mode.service');
        const result = await etsyModeService.run({
            keyword,
            niche: niche || keyword,
            style: style || 'vintage',
            designCount: Math.min(parseInt(designCount) || 20, 50),
            workspaceId
        });

        res.json(result);
    } catch (err) {
        console.error('[Factory Etsy Mode]', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
