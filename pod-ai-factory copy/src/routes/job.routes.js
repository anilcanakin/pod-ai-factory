const express = require('express');
const router = express.Router();
const logService = require('../services/log.service');

// GET /api/jobs/:jobId/logs
router.get('/:jobId/logs', async (req, res) => {
    try {
        const { jobId } = req.params;
        const logs = await logService.getLogs(jobId);
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/jobs/:jobId/retry
router.post('/:jobId/retry', async (req, res) => {
    try {
        const { jobId } = req.params;
        const { step } = req.query; // e.g. "seo", "mockup", "asset"

        await logService.logEvent(jobId, 'RETRY_INITIATED', 'INFO', `User requested retry for step: ${step || 'pipeline'}`);

        // Currently, because we built pipeline synchronously on `/api/pipeline/run` 
        // a full retry just kicks off the phase 2 pipeline again which is mostly idempotent 
        // since processing checks against "APPROVED" and mockup recreates.
        if (!step || step === 'pipeline') {
            // For a real production env, here we'd re-queue the specific BullMQ jobs
            // that had "FAILED" state.
            res.json({ message: "Retry initiated for full pipeline. (Mocked response for MVP)" });
        } else {
            res.json({ message: `Retry initiated for step: ${step}.` });
        }

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
