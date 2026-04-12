const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SUPPORTED_MODELS = {
    'fal-ai/flux/dev': {
        name: 'Flux 2 Dev',
        description: 'Versatile detail, best overall',
        speed: 'medium',
        strength: 'general'
    },
    'fal-ai/flux/schnell': {
        name: 'Flux Schnell',
        description: 'Same quality, 4x faster',
        speed: 'fast',
        strength: 'speed'
    },
    'fal-ai/ideogram/v3': {
        name: 'Ideogram 3.0',
        description: 'Best text & typography in images',
        speed: 'medium',
        strength: 'typography'
    },
    'fal-ai/recraft-v3': {
        name: 'Recraft V4',
        description: 'Vector-clean, perfect for screen print',
        speed: 'medium',
        strength: 'vector'
    }
};

// Per-model cost map (USD per image) — based on FAL.ai pricing as of 2026
// FAL_COST_PER_IMAGE env var acts as a global override when set
const MODEL_COSTS = {
    'fal-ai/flux/dev':     0.030,  // Flux Dev  — high quality, ~$0.03/img
    'fal-ai/flux/schnell': 0.003,  // Flux Schnell — fast & cheap, ~$0.003/img
    'fal-ai/ideogram/v3':  0.080,  // Ideogram 3.0 — typography specialist, ~$0.08/img
    'fal-ai/recraft-v3':   0.040,  // Recraft V3 — vector/screen print, ~$0.04/img
};
const FALLBACK_COST = 0.020; // used for unknown/new models

function getModelCost(modelId) {
    if (process.env.FAL_COST_PER_IMAGE) {
        return parseFloat(process.env.FAL_COST_PER_IMAGE);
    }
    return MODEL_COSTS[modelId] ?? FALLBACK_COST;
}

function imageSizeToAspectRatio(imageSize) {
    const map = {
        'square_hd': '1:1',
        'portrait_4_3': '3:4', 
        'landscape_4_3': '4:3'
    };
    return map[imageSize] || '1:1';
}

function buildModelInput(modelId, prompt, imageSize, negativePrompt = '') {
    const base = { prompt };
    
    if (modelId.includes('ideogram')) {
        return {
            ...base,
            aspect_ratio: imageSizeToAspectRatio(imageSize),
            style_type: 'DESIGN'
        };
    }
    
    if (modelId.includes('recraft')) {
        return {
            ...base,
            image_size: imageSize,
            style: 'vector_illustration',
            negative_prompt: negativePrompt || ''
        };
    }
    
    // Flux default
    return {
        ...base,
        image_size: imageSize,
        num_inference_steps: 28,
        negative_prompt: negativePrompt || 'blurry, low quality, watermark, text, background, scenery'
    };
}

class GenerationService {
    SUPPORTED_MODELS = SUPPORTED_MODELS;

    async checkDailyCap(workspaceId, requestedCount) {
        if (!workspaceId) return; // Legacy jobs or dev mode (null workspace) have no cap

        const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
        const cap = workspace ? workspace.dailyImageCap : parseInt(process.env.DAILY_IMAGE_CAP || '200', 10);

        // Count images generated today for this workspace
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const generatedToday = await prisma.image.count({
            where: {
                job: { workspaceId },
                createdAt: { gte: startOfDay },
                status: 'COMPLETED'
            }
        });

        if (generatedToday + requestedCount > cap) {
            throw new Error(`CAP_REACHED: Cannot generate ${requestedCount} images. Daily cap is ${cap}, already generated ${generatedToday}.`);
        }
    }

    async runGeneration(jobId, engine = 'fal', count = 30, imageSize = 'square_hd', negativePrompt = '') {
        const imagesToGenerate = await prisma.image.findMany({
            where: {
                jobId: jobId,
                imageUrl: 'PENDING'
            },
            take: count
        });

        if (imagesToGenerate.length === 0) return [];

        const job = await prisma.designJob.findUnique({ where: { id: jobId } });
        await this.checkDailyCap(job.workspaceId, imagesToGenerate.length);

        const results = [];
        const falProvider = require('./providers/fal.provider');
        const logService = require('./log.service');

        const processImageWithRetries = async (img, attempts = 0) => {
            try {
                const modelId = SUPPORTED_MODELS[img.engine] ? img.engine : 'fal-ai/flux/dev';
                const modelCost = getModelCost(modelId);
                const payload = buildModelInput(modelId, img.promptUsed.substring(0, 1000), imageSize, negativePrompt);

                const falResponse = await falProvider.generateImage(
                    modelId,
                    payload,
                    job.workspaceId
                );

                // Upload FAL CDN URL to Supabase for permanent hosting.
                // FAL CDN URLs are temporary; storing them directly causes broken/unviewable images.
                let permanentUrl = falResponse.image_url;
                try {
                    const { uploadUrlToStorage } = require('./storage.service');
                    const storagePath = `generated/${img.id}_${Date.now()}.jpg`;
                    permanentUrl = await uploadUrlToStorage(falResponse.image_url, storagePath);
                    console.log(`[Generation] Uploaded to Supabase: ${permanentUrl}`);
                } catch (uploadErr) {
                    // Non-fatal: fall back to FAL CDN URL — image will still display until URL expires
                    console.warn(`[Generation] Supabase upload failed for image ${img.id}, using FAL CDN URL: ${uploadErr.message}`);
                }

                const updated = await prisma.image.update({
                    where: { id: img.id },
                    data: {
                        imageUrl: permanentUrl,
                        seed: falResponse.seed,
                        rawResponse: falResponse.raw_response,
                        engine: modelId,
                        status: 'COMPLETED',
                        cost: modelCost
                    }
                });
                return { success: true, img: updated, cost: modelCost };
            } catch (err) {
                // FalProvider handles its own momentary 429s, but let's keep the upper block 
                // just in case we hit absolute timeout or generic 500s.
                if (err.message.includes('429') && attempts < 3) {
                    console.warn(`[RateLimit] Upper level retry for image ${img.id}. Retrying in ${2 ** attempts}s...`);
                    await new Promise(res => setTimeout(res, (2 ** attempts) * 1000));
                    return processImageWithRetries(img, attempts + 1);
                }

                console.error(`Error generating image ${img.id}:`, err.message);
                const failed = await prisma.image.update({
                    where: { id: img.id },
                    data: { status: 'REJECTED', rawResponse: err.rawResponse || err.message }
                });
                return { success: false, img: failed, error: err.message };
            }
        };

        const chunkSize = parseInt(process.env.CHUNK_SIZE || '5', 10);
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < imagesToGenerate.length; i += chunkSize) {
            const chunk = imagesToGenerate.slice(i, i + chunkSize);
            const chunkResults = await Promise.all(chunk.map(img => processImageWithRetries(img)));

            chunkResults.forEach(res => {
                if (res.success) successCount++;
                else failCount++;
                results.push({ ...res.img, _cost: res.cost || 0 });
            });
        }

        // Emit Observability Log — sum actual per-model costs from results
        const totalCost = results.reduce((sum, r) => sum + (r?._cost || 0), 0);
        await logService.logEvent(jobId, 'GENERATION_DONE', failCount === 0 ? 'SUCCESS' : 'PARTIAL_SUCCESS', `Generated ${successCount}, Failed ${failCount}`, { successCount, failCount, costEstimate: parseFloat(totalCost.toFixed(4)) });

        await prisma.designJob.update({
            where: { id: jobId },
            data: { status: 'COMPLETED' }
        });

        return results;
    }
}
module.exports = new GenerationService();
