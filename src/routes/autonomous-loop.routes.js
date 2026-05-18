const express = require('express');
const router  = express.Router();
const { runLoop, getLoopStatus, saveLoopSettings, runPostProduction } = require('../services/autonomous-loop.service');

// GET /api/loop/status
router.get('/status', async (req, res) => {
    try {
        const status = await getLoopStatus(req.workspaceId || 'default-workspace');
        res.json(status);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/loop/trigger — Manuel tetikleme
router.post('/trigger', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || 'default-workspace';
        res.json({ started: true, message: 'Döngü arka planda başlatıldı' });
        // Yanıt gönderildikten sonra çalıştır (non-blocking)
        runLoop(workspaceId).catch(err =>
            console.error('[AutoLoop] Manuel tetikleme hatası:', err.message)
        );
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/loop/settings
router.patch('/settings', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || 'default-workspace';
        const { autoPublish, enabled, minNewRules, maxIdeas, imagesPerIdea } = req.body;
        const saved = await saveLoopSettings(workspaceId, {
            autoPublish:   autoPublish   ?? false,
            enabled:       enabled       ?? true,
            minNewRules:   minNewRules   ?? 5,
            maxIdeas:      maxIdeas      ?? 2,
            imagesPerIdea: imagesPerIdea ?? 3,
        });
        res.json(saved);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/loop/post-production/:batchJobId — Manuel post-production tetikleme
router.post('/post-production/:batchJobId', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || 'default-workspace';
        res.json({ started: true });
        runPostProduction(req.params.batchJobId, workspaceId).catch(err =>
            console.error('[AutoLoop] Post-production hatası:', err.message)
        );
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
