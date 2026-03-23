const express = require('express');
const router = express.Router();
const multer = require('multer');
const { visionService } = require('../services/vision.service');

// Memory storage for file uploads
const upload = multer({ storage: multer.memoryStorage() });

router.post('/analyze', upload.single('image'), async (req, res) => {
    try {
        const { imageUrl, imageId, jobId } = req.body;
        let imageUrlBase64OrUrl;

        if (req.file) {
            // File upload method
            const base64Image = req.file.buffer.toString('base64');
            const mimeType = req.file.mimetype;
            imageUrlBase64OrUrl = `data:${mimeType};base64,${base64Image}`;
        } else if (imageUrl) {
            // URL method
            imageUrlBase64OrUrl = imageUrl;
        } else {
            return res.status(400).json({ error: 'Please provide either an image file or an imageUrl' });
        }

        const result = await visionService.analyzeImage(imageUrlBase64OrUrl, imageId, jobId);

        // As requested, return the strict parsed JSON structure as the primary response
        return res.status(200).json(result.parsedVisionJson);
    } catch (error) {
        console.error('Vision endpoint error:', error);
        return res.status(500).json({ error: 'Internal server error during vision analysis' });
    }
});

module.exports = router;
