const express = require('express');
const router  = express.Router();
const {
    getTrackedStores,
    addTrackedStore,
    removeTrackedStore,
    scanAllStores,
} = require('../services/power-seller-monitor.service');

// GET /api/power-seller/stores
router.get('/stores', (req, res) => {
    res.json(getTrackedStores());
});

// POST /api/power-seller/stores
router.post('/stores', (req, res) => {
    const { shopUrl, shopName, notes } = req.body;
    if (!shopUrl) return res.status(400).json({ error: 'shopUrl zorunlu.' });
    const result = addTrackedStore({ shopUrl, shopName, notes });
    res.status(result.success ? 200 : 400).json(result);
});

// DELETE /api/power-seller/stores/:id
router.delete('/stores/:id', (req, res) => {
    const result = removeTrackedStore(req.params.id);
    res.status(result.success ? 200 : 404).json(result);
});

// POST /api/power-seller/scan — Manuel tetikleme
router.post('/scan', async (req, res) => {
    const workspaceId = req.workspaceId || 'default-workspace';
    try {
        const result = await scanAllStores(workspaceId);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
