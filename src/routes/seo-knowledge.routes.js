const express = require('express');
const router = express.Router();
const {
    getKnowledge,
    autoUpdateKnowledge,
    manualUpdateKnowledge,
    getHistory,
    activateVersion
} = require('../services/seo-knowledge.service');

// GET /api/seo-knowledge — aktif knowledge'i getir
router.get('/', async (req, res) => {
    try {
        const [content, history] = await Promise.all([
            getKnowledge(req.workspaceId),
            getHistory(req.workspaceId)
        ]);
        res.json({ content, history });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/seo-knowledge/auto-update — otomatik güncelle
router.post('/auto-update', async (req, res) => {
    try {
        const kb = await autoUpdateKnowledge(req.workspaceId);
        res.json({ success: true, id: kb.id, message: 'Knowledge base updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/seo-knowledge/manual — manuel güncelle
router.post('/manual', async (req, res) => {
    try {
        const { content } = req.body;
        if (!content || content.length < 100) {
            return res.status(400).json({ error: 'Content too short (min 100 chars)' });
        }
        const kb = await manualUpdateKnowledge(req.workspaceId, content);
        res.json({ success: true, id: kb.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/seo-knowledge/activate/:id — versiyonu aktif yap
router.post('/activate/:id', async (req, res) => {
    try {
        const kb = await activateVersion(req.workspaceId, req.params.id);
        res.json({ success: true, kb });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
