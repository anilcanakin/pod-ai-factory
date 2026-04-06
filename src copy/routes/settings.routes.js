const express = require('express');
const router = express.Router();
const secretsService = require('../services/secrets.service');

// GET /api/settings — get provider key status (never reveals key values)
router.get('/', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || null;
        const status = await secretsService.providerStatus(workspaceId);
        res.json({ workspaceId, providerStatus: status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/settings/keys — save a workspace API key
router.post('/keys', async (req, res) => {
    const { provider, keyValue } = req.body;
    const workspaceId = req.workspaceId;

    if (!workspaceId) {
        return res.status(400).json({ error: 'No workspace found. Please log in with a real account.' });
    }
    if (!provider || !keyValue) {
        return res.status(400).json({ error: 'provider and keyValue are required' });
    }
    if (!['fal', 'openai', 'bg_remove', 'upscaler'].includes(provider)) {
        return res.status(400).json({ error: 'Unknown provider' });
    }

    try {
        await secretsService.setKey(workspaceId, provider, keyValue);
        res.json({ ok: true, provider, configured: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/settings/keys/:provider — remove a workspace key
router.delete('/keys/:provider', async (req, res) => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) return res.status(400).json({ error: 'No workspace' });

    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    try {
        await prisma.workspaceApiKey.deleteMany({
            where: { workspaceId, provider: req.params.provider }
        });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
