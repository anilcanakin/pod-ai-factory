const express = require('express');
const router = express.Router();
const promptService = require('../services/prompt.service');
const variationService = require('../services/variation.service');

// POST /api/prompt/synthesize
router.post('/synthesize', async (req, res) => {
    try {
        const { jobId } = req.body;
        const result = await promptService.synthesize(jobId);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/prompt/variations
router.post('/variations', async (req, res) => {
    try {
        const { jobId, count = 30 } = req.body;
        const variations = await variationService.generateVariations(jobId, count);
        res.json(variations);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
