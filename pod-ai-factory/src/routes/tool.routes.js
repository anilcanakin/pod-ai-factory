const express = require('express');
const router = express.Router();
const multer = require('multer');

// Memory storage for incoming images if we upload them directly
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/tools/bg-remove
// Input: multipart image upload or { imageId, imageUrl }
// Output: transparentPngUrl (stubbed to return the original URL with a suffix for testing)
router.post('/bg-remove', upload.single('image'), async (req, res) => {
    try {
        const { imageId, imageUrl } = req.body;

        let targetUrl = imageUrl;

        // In a real scenario, this would call BG_REMOVE_API_URL and await the transparent output.
        // For the MVP, we simulate a successful call that returns a processed URL.
        const transparentPngUrl = targetUrl ? `${targetUrl}_nobg.png` : 'stub_transparent_nobg.png';

        return res.status(200).json({ transparentPngUrl });
    } catch (error) {
        console.error('BG Remove error:', error);
        return res.status(500).json({ error: 'Failed to process background removal' });
    }
});

// POST /api/tools/upscale
// Input: { imageId, imageUrl, scale: 2|4, mode: "design"|"mockup" }
// Output: upscaledUrl (stubbed for now)
router.post('/upscale', async (req, res) => {
    try {
        const { imageId, imageUrl, scale = 4, mode = 'design' } = req.body;

        // In a real scenario, call UPSCALER_API_URL here.
        const upscaledUrl = imageUrl ? `${imageUrl}_upscaled_${scale}x_${mode}.png` : `stub_upscaled_${scale}x_${mode}.png`;

        return res.status(200).json({ upscaledUrl });
    } catch (error) {
        console.error('Upscale error:', error);
        return res.status(500).json({ error: 'Failed to process upscale' });
    }
});

module.exports = router;
