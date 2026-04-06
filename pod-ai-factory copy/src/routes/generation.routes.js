const express = require('express');
const router = express.Router();
const generationService = require('../services/generation.service');

// POST /api/generate/run
router.post('/run', async (req, res) => {
    try {
        const { jobId, engine = "openai", count = 30 } = req.body;

        // Asynchronous processing since this takes long, return acknowledgment early or await.
        // It's a demo, so we will await and return the response, but it can take up to 60s
        // Express default timeout is 120s typically.
        const results = await generationService.runGeneration(jobId, engine, count);
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
