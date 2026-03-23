const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const { visionService } = require('../services/vision.service');
const promptService = require('../services/prompt.service');
const variationService = require('../services/variation.service');
const generationService = require('../services/generation.service');
const logService = require('../services/log.service');
const usageMiddleware = require('../config/usage.middleware');

const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } }
});

// Helper: mark job FAILED and log the failure
async function failJob(jobId, step, err) {
    const msg = err?.message || String(err);
    await Promise.allSettled([
        prisma.designJob.update({ where: { id: jobId }, data: { status: 'FAILED' } }),
        logService.logEvent(jobId, step, 'FAILED', msg)
    ]);
}

// POST /api/factory/extract-style
// Standalone endpoint to use Vision API to extract "Design Grammar" from a reference image.
router.post('/extract-style', usageMiddleware, async (req, res) => {
    try {
        const { referenceImageId } = req.body;
        if (!referenceImageId) return res.status(400).json({ error: 'referenceImageId is required.' });

        const workspaceId = req.workspaceId;
        if (!workspaceId) return res.status(401).json({ error: 'Authentication required.' });

        const useVision = process.env.USE_VISION === 'true'
            && process.env.OPENAI_API_KEY
            && process.env.OPENAI_API_KEY.length > 10
            && process.env.OPENAI_API_KEY !== 'your_openai_api_key';

        if (!useVision) {
            // Synthetic fallback for local testing without API key
            const syntheticData = {
                style: 'vintage distressed',
                layout: 'centered badge',
                icon_description: 'roaring eagle',
                typography: 'bold collegiate arch',
                palette: ['navy', 'offwhite', 'red']
            };
            return res.json({ grammar: syntheticData, isSynthetic: true });
        }

        // Call vision API
        const dbRecord = await visionService.analyzeImage(referenceImageId, null, null);
        res.json({ grammar: dbRecord.parsedVisionJson, isSynthetic: false });
    } catch (err) {
        console.error('[Factory Extract Style]', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/factory/run
router.post('/run', usageMiddleware, async (req, res) => {
    let jobId = null;
    try {
        const {
            referenceImageId,
            engines = ['fal'],        // deprecated param — fal is always used
            variationCount = 30,
            generateCount = 30,
            autoApprove = false,
            imageSize = 'square_hd',
            visionData = null,
            variationTypes = []
        } = req.body;

        if (!referenceImageId) return res.status(400).json({ error: 'referenceImageId is required.' });

        const workspaceId = req.workspaceId;
        if (!workspaceId) {
            return res.status(401).json({ error: 'Authentication required. Missing workspace context.' });
        }

        const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
        if (!workspace) {
            return res.status(403).json({ error: 'Invalid workspace context.' });
        }

        const cap = workspace.concurrentJobCap || parseInt(process.env.CONCURRENT_JOB_CAP || '2', 10);

        const activeJobs = await prisma.designJob.count({
            where: { workspaceId, status: 'PROCESSING' }
        });

        if (activeJobs >= cap) {
            return res.status(429).json({ error: `Concurrent Job Limit Reached: Maximum ${cap} active jobs allowed for this workspace.` });
        }

        // 1. Create Job
        let job = await prisma.designJob.findFirst({
            where: { originalImage: referenceImageId, status: { not: 'COMPLETED' }, workspaceId }
        });

        if (!job) {
            job = await prisma.designJob.create({
                data: { originalImage: referenceImageId, status: 'PROCESSING', workspaceId }
            });
        } else {
            await prisma.designJob.update({ where: { id: job.id }, data: { status: 'PROCESSING' } });
        }

        jobId = job.id;
        await logService.logEvent(jobId, 'FACTORY_RUN_START', 'SUCCESS', `Starting run for reference: ${referenceImageId}`);

        // 2. Vision — always check USE_VISION flag
        const existingVision = await prisma.visionAnalysis.findFirst({ where: { jobId } });
        if (!existingVision) {
            if (visionData) {
                // UI explicitly passed the JSON output — skip calling Vision API again
                await prisma.visionAnalysis.create({
                    data: {
                        jobId,
                        rawProviderResponse: JSON.stringify(visionData),
                        parsedVisionJson: visionData
                    }
                });
                await logService.logEvent(jobId, 'VISION_SKIPPED', 'SUCCESS', 'UI explicitly provided parsed Vision Data from Extract Prompt step.');
            } else {
                const useVision = process.env.USE_VISION === 'true'
                    && process.env.OPENAI_API_KEY
                    && process.env.OPENAI_API_KEY.length > 10
                    && process.env.OPENAI_API_KEY !== 'your_openai_api_key';

                if (useVision) {
                    try {
                        await visionService.analyzeImage(referenceImageId, null, jobId);
                        await logService.logEvent(jobId, 'VISION_DONE', 'SUCCESS', 'OpenAI Vision analyzed reference image.');
                    } catch (err) {
                        await failJob(jobId, 'VISION_DONE', err);
                        return res.status(500).json({ error: `Vision step failed: ${err.message}`, jobId });
                    }
                } else {
                    // Deterministic synthetic vision based on reference filename
                    const refName = referenceImageId.toLowerCase();
                    let niche = 'patriotic_americana';
                    if (refName.includes('gym') || refName.includes('fitness')) niche = 'gym_fitness';
                    else if (refName.includes('pet') || refName.includes('dog') || refName.includes('cat')) niche = 'pet_lovers';
                    else if (refName.includes('game') || refName.includes('nerd')) niche = 'gaming_nerd';
                    else if (refName.includes('outdoor') || refName.includes('camp')) niche = 'outdoor_camping';
                    else if (refName.includes('usa') || refName.includes('america') || refName.includes('flag')) niche = 'usa_patriotic';
                    else if (refName.includes('sport') || refName.includes('varsity')) niche = 'sports_varsity';

                    const syntheticData = {
                        style: 'vintage_distressed',
                        palette: ['navy', 'offwhite', 'vintage_red'],
                        palette_hex: ['#1a2744', '#f5f0e8', '#c0392b'],
                        composition: 'centered_graphic',
                        icon_family: ['eagle', 'shield', 'star'],
                        text_layout: 'top_year_mid_banner_bottom_hook',
                        niche_guess: niche
                    };

                    await prisma.visionAnalysis.create({
                        data: {
                            jobId,
                            rawProviderResponse: JSON.stringify(syntheticData),
                            parsedVisionJson: syntheticData
                        }
                    });
                    await logService.logEvent(jobId, 'VISION_SKIPPED', 'SUCCESS',
                        `USE_VISION=false — synthetic vision injected (niche: ${niche}).`);
                }
            }
        } else {
            await logService.logEvent(jobId, 'VISION_SKIPPED', 'SUCCESS', 'Vision data already exists (idempotent).');
        }

        // 3. Prompt Synth
        const freshJob = await prisma.designJob.findUnique({ where: { id: jobId } });
        if (!freshJob.basePrompt) {
            try {
                await promptService.synthesize(jobId);
                await logService.logEvent(jobId, 'PROMPT_SYNTH_DONE', 'SUCCESS', 'Base prompt synthesized.');
            } catch (err) {
                await failJob(jobId, 'PROMPT_SYNTH_DONE', err);
                return res.status(500).json({ error: `Prompt synth failed: ${err.message}`, jobId });
            }
        }

        // 4. Variations
        const existingImages = await prisma.image.count({ where: { jobId } });
        if (existingImages < variationCount) {
            const remaining = variationCount - existingImages;
            try {
                await variationService.generateVariations(jobId, remaining, variationTypes);
                await logService.logEvent(jobId, 'VARIATIONS_CREATED', 'SUCCESS', `Created ${remaining} variation rows.`);
            } catch (err) {
                await failJob(jobId, 'VARIATIONS_CREATED', err);
                return res.status(500).json({ error: `Variation creation failed: ${err.message}`, jobId });
            }
        }

        // 5. Generation
        const pendingImages = await prisma.image.count({ where: { jobId, imageUrl: 'PENDING' } });
        if (pendingImages > 0) {
            const runCount = Math.min(pendingImages, generateCount);
            try {
                await generationService.runGeneration(jobId, 'fal', runCount, imageSize);
            } catch (err) {
                // Partial failures are tracked inside runGeneration — only throw on total failure
                await logService.logEvent(jobId, 'GENERATION_DONE', 'FAILED', err.message);
                await failJob(jobId, 'GENERATION_FATAL', err);
                return res.status(500).json({ error: `Generation failed: ${err.message}`, jobId });
            }
        }

        // 6. Auto-approve
        if (autoApprove) {
            const finished = await prisma.image.findMany({ where: { jobId, status: 'COMPLETED' } });
            for (const img of finished) {
                await prisma.image.update({ where: { id: img.id }, data: { isApproved: true, status: 'APPROVED' } });
            }
            await logService.logEvent(jobId, 'AUTO_APPROVE', 'SUCCESS', `Auto-approved ${finished.length} images.`);
        }

        // 7. Mark COMPLETED
        await prisma.designJob.update({ where: { id: jobId }, data: { status: 'COMPLETED' } });
        await logService.logEvent(jobId, 'FACTORY_RUN_DONE', 'SUCCESS', 'All steps completed.');

        const logs = await logService.getLogs(jobId);
        res.json({
            jobId,
            message: 'Factory run completed.',
            logs: logs.map(l => ({ step: l.eventType, status: l.status, message: l.message }))
        });

    } catch (err) {
        console.error('[Factory] Unexpected error:', err.stack || err);
        if (jobId) await failJob(jobId, 'FACTORY_RUN_ERROR', err).catch(() => { });
        res.status(500).json({ error: err.message, stack: err.stack, jobId });
    }
});

// POST /api/factory/retry/:jobId
// Retries a FAILED job by resetting its status to PROCESSING. The frontend can just call /run again if it wants, 
// but this gives a clean dedicated endpoint that doesn't need all the req.body parameters.
router.post('/retry/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = await prisma.designJob.findUnique({ where: { id: jobId, workspaceId: req.workspaceId } });

        if (!job) return res.status(404).json({ error: 'Job not found' });
        if (job.status !== 'FAILED') return res.status(400).json({ error: 'Only FAILED jobs can be retried' });

        await prisma.designJob.update({ where: { id: jobId }, data: { status: 'PROCESSING' } });
        // NOTE: The actual generation process must be re-triggered by the frontend calling POST /run with the same reference image,
        // or we could extract runFactoryJob(jobId) and call it in background here.
        // For SaaS MVP, resetting the state to PROCESSING allows the frontend "Retry" sequence to work idempotently if hitting /run.
        res.json({ message: 'Job reset to PROCESSING mode. Re-run factory with the same reference image to resume.', jobId });
    } catch (err) {
        console.error('[Factory Retry]', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/factory/generate-variations
// Step 3 of Krafie Clone architecture: Received edited JSON grammar and array of icons
// Builds prompts and starts generation.
router.post('/generate-variations', usageMiddleware, async (req, res) => {
    let { jobId } = req.body;
    try {
        const { referenceImageId, grammar, iconsList, imageSize = 'square_hd' } = req.body;

        if (!referenceImageId) return res.status(400).json({ error: 'referenceImageId is required.' });
        if (!grammar || !grammar.style) return res.status(400).json({ error: 'Invalid Design Grammar.' });
        if (!iconsList || !Array.isArray(iconsList) || iconsList.length === 0) return res.status(400).json({ error: 'iconsList must be a non-empty array.' });

        const workspaceId = req.workspaceId;
        if (!workspaceId) return res.status(401).json({ error: 'Authentication required.' });

        const cap = parseInt(process.env.CONCURRENT_JOB_CAP || '2', 10);
        const activeJobs = await prisma.designJob.count({
            where: { workspaceId, status: 'PROCESSING' }
        });
        if (activeJobs >= cap) {
            return res.status(429).json({ error: `Concurrent Job Limit Reached: Maximum ${cap} active jobs allowed.` });
        }

        // 1. Create or Resume Job
        let job = await prisma.designJob.findFirst({
            where: { originalImage: referenceImageId, status: { not: 'COMPLETED' }, workspaceId }
        });

        if (!job) {
            job = await prisma.designJob.create({
                data: { originalImage: referenceImageId, status: 'PROCESSING', workspaceId }
            });
        } else {
            await prisma.designJob.update({ where: { id: job.id }, data: { status: 'PROCESSING' } });
        }
        jobId = job.id;
        await logService.logEvent(jobId, 'FACTORY_GENERATION_START', 'SUCCESS', 'Starting variation generation (Style Cloning).');

        // 2. Generate Variation Prompts
        await variationService.generateVariations(jobId, grammar, iconsList);
        await logService.logEvent(jobId, 'VARIATIONS_CREATED', 'SUCCESS', `Created ${iconsList.length} variation prompts.`);

        // 3. Start Generation (Background or awaited if quick)
        // For production, we don't await thousands, but we have a limit anyway.
        // We'll trust runGeneration to handle batching inside.
        try {
            await generationService.runGeneration(jobId, 'fal', iconsList.length, imageSize);
            await logService.logEvent(jobId, 'GENERATION_DONE', 'SUCCESS', 'All images generated.');
        } catch (err) {
            await logService.logEvent(jobId, 'GENERATION_DONE', 'FAILED', err.message);
            await failJob(jobId, 'GENERATION_FATAL', err);
            return res.status(500).json({ error: `Generation failed: ${err.message}`, jobId });
        }

        // 4. Mark COMPLETED
        await prisma.designJob.update({ where: { id: jobId }, data: { status: 'COMPLETED' } });

        res.json({ message: 'Generation complete.', jobId });
    } catch (err) {
        console.error('[Factory Generate Variations]', err);
        if (jobId) await failJob(jobId, 'FACTORY_GENERATION_ERROR', err).catch(() => { });
        res.status(500).json({ error: err.message, jobId });
    }
});

// POST /api/factory/etsy-mode — Full Etsy Seller Mode: keyword → 20 designs → mockups → SEO → CSV
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
