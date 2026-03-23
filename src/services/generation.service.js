const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
    datasources: {
        db: { url: process.env.DATABASE_URL }
    }
});

class GenerationService {
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

    async runGeneration(jobId, engine = 'fal', count = 30, imageSize = 'square_hd') {
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

        const costPerImage = parseFloat(process.env.FAL_COST_PER_IMAGE || '0.02');

        const results = [];
        const falProvider = require('./providers/fal.provider');
        const logService = require('./log.service');

        const processImageWithRetries = async (img, attempts = 0) => {
            try {
                const falResponse = await falProvider.generateImage(
                    img.promptUsed.substring(0, 1000),
                    imageSize,
                    1,
                    null, // default seed
                    job.workspaceId
                );

                const updated = await prisma.image.update({
                    where: { id: img.id },
                    data: {
                        imageUrl: falResponse.image_url,
                        seed: falResponse.seed,
                        rawResponse: falResponse.raw_response,
                        engine: 'fal.ai/flux/dev',
                        status: 'COMPLETED',
                        cost: costPerImage
                    }
                });
                return { success: true, img: updated };
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
                results.push(res.img);
            });
        }

        // Emit Observability Log
        await logService.logEvent(jobId, 'GENERATION_DONE', failCount === 0 ? 'SUCCESS' : 'PARTIAL_SUCCESS', `Generated ${successCount}, Failed ${failCount}`, { successCount, failCount, costEstimate: successCount * costPerImage });

        await prisma.designJob.update({
            where: { id: jobId },
            data: { status: 'COMPLETED' }
        });

        return results;
    }
}
module.exports = new GenerationService();
