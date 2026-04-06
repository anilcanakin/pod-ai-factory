const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class VariationService {
    /**
     * @param {string} jobId 
     * @param {Object} grammar - The parsedVisionJson containing style, layout, typography, palette
     * @param {string[]} iconsList - Array of short icon descriptions (e.g. ["wolf", "eagle", "roaring tiger"])
     */
    async generateVariations(jobId, grammar, iconsList) {
        const job = await prisma.designJob.findUnique({ where: { id: jobId } });
        if (!job) throw new Error("Job not found");

        if (!iconsList || iconsList.length === 0) {
            throw new Error("No icons provided for variation.");
        }

        const createdImages = [];

        // Ensure palette is safely joined
        const paletteStr = Array.isArray(grammar.palette) ? grammar.palette.join(", ") : grammar.palette;

        for (let i = 0; i < iconsList.length; i++) {
            const iconName = iconsList[i].trim();
            if (!iconName) continue;

            const promptUsed = `A clean vector graphic illustration of a ${iconName}, designed in a ${grammar.style} style with a ${grammar.layout} layout. Color palette: ${paletteStr}. Typography style influence: ${grammar.typography}. CRITICAL: The design MUST be completely isolated on a pure, solid white background (#FFFFFF). Flat shading, high contrast, perfect for t-shirt screen printing, no messy edges, no background scenery.`;

            const img = await prisma.image.create({
                data: {
                    jobId: job.id,
                    variantType: "style_clone", // Mark as style clone
                    promptUsed: promptUsed,
                    engine: 'fal.ai/flux/dev',
                    imageUrl: 'PENDING',
                    status: 'GENERATED'
                }
            });
            console.log(`[VariationService] Inserted Style Clone - JobId: ${img.jobId} | ImageId: ${img.id} | Icon: ${iconName}`);
            createdImages.push(img);
        }

        return createdImages;
    }
}
module.exports = new VariationService();
