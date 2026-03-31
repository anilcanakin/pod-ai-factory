const express = require('express');
const router = express.Router();
const { fal } = require('@fal-ai/client');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { logNotification } = require('./notification.routes');

fal.config({ 
    credentials: process.env.FAL_API_KEY || process.env.FAL_KEY 
});

// POST /api/tools/remove-bg
router.post('/remove-bg', async (req, res) => {
    try {
        const { imageUrl, model = 'birefnet' } = req.body;
        if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' });

        const workspaceId = req.workspaceId;
        if (!workspaceId) return res.status(401).json({ error: 'Authentication required.' });

        let result;

        if (model === 'bria') {
            // Bria RMBG 2.0 — ücretli, ticari lisanslı ($0.018/görsel)
            result = await fal.subscribe('fal-ai/bria/background/remove', {
                input: { image_url: imageUrl }
            });
        } else if (model === 'pixelcut') {
            // Pixelcut — e-commerce optimized background removal
            result = await fal.subscribe('pixelcut/background-removal', {
                input: { image_url: imageUrl }
            });
        } else {
            // BiRefNet — ücretsiz, yüksek kalite (default)
            result = await fal.subscribe('fal-ai/birefnet', {
                input: {
                    image_url: imageUrl,
                    model: 'General Use (Light)',
                    operating_resolution: '1024x1024',
                    output_format: 'png'
                }
            });
        }

        console.log('[Tool] Raw result:', JSON.stringify(result, null, 2));

        const outputUrl = result?.data?.image?.url
            || result?.image?.url
            || result?.images?.[0]?.url
            || null;

        if (!outputUrl) {
            return res.status(500).json({ error: 'No output image returned from model' });
        }

        const modelLabel = model === 'bria' ? 'Bria RMBG 2.0'
            : model === 'pixelcut' ? 'Pixelcut'
            : 'BiRefNet';

        logNotification(workspaceId, 'success', `Background removed — ${modelLabel}`, { model: modelLabel });
        res.json({
            url: outputUrl,
            model: modelLabel
        });

    } catch (err) {
        console.error('[Remove BG]', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/tools/upscale
router.post('/upscale', async (req, res) => {
    try {
        const { imageUrl, scale = 4 } = req.body;
        if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' });

        const workspaceId = req.workspaceId;
        if (!workspaceId) return res.status(401).json({ error: 'Authentication required.' });

        const scaleFactor = parseInt(scale, 10) || 4;

        const result = await fal.subscribe('fal-ai/aura-sr', {
            input: {
                image_url: imageUrl,
                upscaling_factor: scaleFactor,
                overlapping_tiles: true,
                checkpoint: 'v2'
            }
        });

        console.log('[Tool] Raw result:', JSON.stringify(result, null, 2));

        const outputUrl = result?.data?.image?.url
            || result?.data?.images?.[0]?.url
            || result?.image?.url
            || result?.images?.[0]?.url
            || null;

        if (!outputUrl) {
            return res.status(500).json({ error: 'No output image returned from model' });
        }

        res.json({
            url: outputUrl,
            scale: `${scaleFactor}x`,
            model: 'AuraSR v2'
        });

    } catch (err) {
        console.error('[Upscale]', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/tools/vectorize
router.post('/vectorize', async (req, res) => {
    try {
        const { imageUrl } = req.body;
        if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' });

        const workspaceId = req.workspaceId;
        if (!workspaceId) return res.status(401).json({ error: 'Authentication required.' });

        const result = await fal.subscribe('fal-ai/recraft-v3', {
            input: {
                prompt: 'vector illustration, clean vector art, solid colors, minimal',
                style: 'vector_illustration',
                image_url: imageUrl,
            }
        });

        console.log('[Vectorize] Raw result:', JSON.stringify(result, null, 2));

        const outputUrl = result?.data?.images?.[0]?.url
            || result?.images?.[0]?.url
            || result?.data?.image?.url
            || result?.image?.url
            || null;

        if (!outputUrl) {
            return res.status(500).json({ error: 'No output image returned from model' });
        }

        logNotification(workspaceId, 'success', 'Vector conversion completed', { model: 'Recraft v3' });
        res.json({ url: outputUrl, model: 'Recraft v3' });

    } catch (err) {
        console.error('[Vectorize]', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
