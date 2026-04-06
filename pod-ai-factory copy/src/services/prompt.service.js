const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
    datasources: {
        db: { url: process.env.DATABASE_URL }
    }
});

class PromptService {
    async synthesize(jobId) {
        const visionAnalysis = await prisma.visionAnalysis.findFirst({
            where: { jobId },
            orderBy: { createdAt: 'desc' }
        });

        if (!visionAnalysis) throw new Error("Vision analysis not found for job");

        const json = visionAnalysis.parsedVisionJson;

        const icons = Array.isArray(json.icon_family) ? json.icon_family.join(', ') : (json.icon_family || '');
        const pal = Array.isArray(json.palette) ? json.palette.join(', ') : (json.palette || '');
        const base_prompt = `Design a t-shirt graphic in ${json.style} style. Composition: ${json.composition}. Text layout: ${json.text_layout}. Theme/niche: ${json.niche_guess}. Includes elements like: ${icons}. Use a color palette primarily composed of: ${pal}.`;

        const negative_prompt = "low quality, blurry, photorealistic (unless requested), watermarks, text errors";

        const engine_params = {
            size: "1024x1024",
            style_strength: 0.7
        };

        const job = await prisma.designJob.update({
            where: { id: jobId },
            data: {
                basePrompt: base_prompt,
                negativePrompt: negative_prompt
            }
        });

        return {
            base_prompt,
            negative_prompt,
            engine_params
        };
    }
}

module.exports = new PromptService();
