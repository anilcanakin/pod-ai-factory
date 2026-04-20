const express = require('express');
const router  = express.Router();
const scout   = require('../services/scout.service');

/**
 * POST /api/scout/suggest
 * Google Trends + Pinterest → Claude Haiku → 5 micro-niche öner
 */
router.post('/suggest', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || 'default-workspace';
        const result = await scout.runScout(workspaceId);
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('[Scout route]', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/scout/suggestions
 * Kaydedilmiş Scout önerilerini listele
 */
router.get('/suggestions', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || 'default-workspace';
        const { limit = 30 } = req.query;
        const suggestions = await scout.listSuggestions(workspaceId, parseInt(limit, 10));
        res.json({ success: true, count: suggestions.length, suggestions });
    } catch (err) {
        console.error('[Scout route]', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
