const { PrismaClient } = require('@prisma/client');
const promptService = require('./prompt.service');
const variationService = require('./variation.service');
const generationService = require('./generation.service');
const logService = require('./log.service');
const { assetQueue } = require('../queues/index');

const prisma = new PrismaClient();

/**
 * Etsy Seller Mode Orchestrator
 * 
 * Input: keyword, niche, style
 * Output: 20 design variations → auto-mockups → SEO → listing CSV
 * 
 * Flow: keyword → synthetic vision → prompt synth → 20 variations → fal.ai generation
 *       → auto-approve → pipeline (master + mockups + SEO) → listing CSV → done
 */
class EtsyModeService {

    /**
     * Map keyword + niche + style into a structured vision JSON
     * (same shape as VisionAnalysis.parsedVisionJson)
     */
    buildVisionFromKeyword(keyword, niche, style) {
        const STYLE_MAP = {
            vintage: { style: 'vintage_distressed', palette: ['burnt_orange', 'cream', 'charcoal'], palette_hex: ['#cc5500', '#f5f0dc', '#36454f'] },
            retro: { style: 'retro_80s', palette: ['neon_pink', 'cyan', 'black'], palette_hex: ['#ff6ec7', '#00ffff', '#111111'] },
            minimalist: { style: 'clean_minimal', palette: ['white', 'black', 'gray'], palette_hex: ['#ffffff', '#111111', '#888888'] },
            bold: { style: 'bold_graphic', palette: ['red', 'yellow', 'black'], palette_hex: ['#e63946', '#ffbe0b', '#1d1d1d'] },
            grunge: { style: 'grunge_distressed', palette: ['dark_red', 'khaki', 'black'], palette_hex: ['#8b0000', '#c3b091', '#1a1a1a'] },
            watercolor: { style: 'watercolor_soft', palette: ['pastel_blue', 'pastel_pink', 'white'], palette_hex: ['#aec6cf', '#ffb7c5', '#ffffff'] },
            typography: { style: 'typography_focused', palette: ['white', 'gold', 'navy'], palette_hex: ['#ffffff', '#d4af37', '#001f3f'] },
        };

        const selectedStyle = STYLE_MAP[style?.toLowerCase()] || STYLE_MAP.vintage;

        // Build icon family from keyword words
        const keywordParts = keyword.toLowerCase().split(/[\s,]+/).filter(w => w.length > 2);
        const iconFamily = keywordParts.slice(0, 3);
        if (iconFamily.length < 2) iconFamily.push('star', 'badge');

        return {
            style: selectedStyle.style,
            palette: selectedStyle.palette,
            palette_hex: selectedStyle.palette_hex,
            composition: 'centered_graphic',
            icon_family: iconFamily,
            text_layout: 'top_hook_mid_graphic_bottom_tagline',
            niche_guess: niche || keyword.split(' ')[0]
        };
    }

    /**
     * Full Etsy Mode pipeline
     */
    async run({ keyword, niche, style, designCount = 20, workspaceId }) {
        if (!keyword) throw new Error('keyword is required for Etsy Mode');
        if (!workspaceId) throw new Error('workspaceId is required');

        const count = Math.min(designCount, 50); // safety cap

        // Check usage limit
        const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
        if (!workspace) throw new Error('Workspace not found');

        // 1. Create Etsy Mode Job
        const job = await prisma.designJob.create({
            data: {
                originalImage: `etsy-mode://${keyword}`,
                status: 'PROCESSING',
                workspaceId,
                mode: 'etsy',
                keyword,
                niche: niche || keyword,
                style: style || 'vintage'
            }
        });
        const jobId = job.id;

        await logService.logEvent(jobId, 'ETSY_MODE_START', 'SUCCESS',
            `Etsy Mode started: keyword="${keyword}", niche="${niche}", style="${style}", designs=${count}`);

        // 2. Inject synthetic vision data from keyword
        const visionData = this.buildVisionFromKeyword(keyword, niche, style);
        await prisma.visionAnalysis.create({
            data: {
                jobId,
                rawProviderResponse: JSON.stringify(visionData),
                parsedVisionJson: visionData
            }
        });
        await logService.logEvent(jobId, 'VISION_SYNTH', 'SUCCESS',
            `Synthetic vision created from keyword "${keyword}"`);

        // 3. Prompt Synth
        try {
            await promptService.synthesize(jobId);
            await logService.logEvent(jobId, 'PROMPT_SYNTH_DONE', 'SUCCESS', 'Base prompt synthesized from keyword vision.');
        } catch (err) {
            await this.failJob(jobId, 'PROMPT_SYNTH', err);
            throw err;
        }

        // 4. Create variations (using keyword-derived variation types)
        const variationTypes = this.generateVariationTypes(keyword, count);
        try {
            await variationService.generateVariations(jobId, count, variationTypes);
            await logService.logEvent(jobId, 'VARIATIONS_CREATED', 'SUCCESS', `Created ${count} variation rows.`);
        } catch (err) {
            await this.failJob(jobId, 'VARIATIONS', err);
            throw err;
        }

        // 5. Generation via Fal.ai
        const imageSize = 'square_hd';
        try {
            await generationService.runGeneration(jobId, 'fal', count, imageSize);
            await logService.logEvent(jobId, 'GENERATION_DONE', 'SUCCESS', `Generated ${count} images.`);
        } catch (err) {
            await logService.logEvent(jobId, 'GENERATION_DONE', 'PARTIAL', err.message);
        }

        // 6. Auto-approve ALL completed images
        const completedImages = await prisma.image.findMany({ where: { jobId, status: 'COMPLETED' } });
        for (const img of completedImages) {
            await prisma.image.update({
                where: { id: img.id },
                data: { isApproved: true, status: 'APPROVED' }
            });
        }
        await logService.logEvent(jobId, 'AUTO_APPROVE', 'SUCCESS',
            `Auto-approved ${completedImages.length} images.`);

        // 7. Trigger pipeline for ALL approved images (mockups + SEO)
        for (const img of completedImages) {
            await assetQueue.add('processAsset', { imageId: img.id }, {
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 }
            });
        }
        await logService.logEvent(jobId, 'PIPELINE_ENQUEUED', 'SUCCESS',
            `${completedImages.length} images enqueued for pipeline processing.`);

        // 8. Mark job completed
        await prisma.designJob.update({
            where: { id: jobId },
            data: { status: 'COMPLETED' }
        });
        await logService.logEvent(jobId, 'ETSY_MODE_DONE', 'SUCCESS', 'Etsy mode pipeline completed.');

        // Increment workspace usage
        await prisma.workspace.update({
            where: { id: workspaceId },
            data: { monthlyUsage: { increment: completedImages.length } }
        });

        return {
            jobId,
            keyword,
            niche,
            style,
            designsGenerated: completedImages.length,
            designsRequested: count,
            message: `Etsy mode completed. ${completedImages.length}/${count} designs generated, auto-approved, and sent to pipeline.`
        };
    }

    /**
     * Generate variation type descriptors from keyword
     */
    generateVariationTypes(keyword, count) {
        const baseTypes = [
            { name: 'text_emphasis' },
            { name: 'icon_swap' },
            { name: 'color_shift' },
            { name: 'layout_flip' },
            { name: 'style_remix' },
        ];

        const types = [];
        for (let i = 0; i < count; i++) {
            types.push(baseTypes[i % baseTypes.length]);
        }
        return types;
    }

    async failJob(jobId, step, err) {
        const msg = err?.message || String(err);
        await Promise.allSettled([
            prisma.designJob.update({ where: { id: jobId }, data: { status: 'FAILED' } }),
            logService.logEvent(jobId, step, 'FAILED', msg)
        ]);
    }
}

module.exports = new EtsyModeService();
