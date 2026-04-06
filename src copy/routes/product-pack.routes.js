const express = require('express');
const router = express.Router();
const productPackService = require('../services/product-pack.service');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// GET /api/packs/products — list available product types
router.get('/products', (req, res) => {
    const products = productPackService.getDefaultProducts();
    res.json(products);
});

// GET /api/packs — list workspace packs
router.get('/', async (req, res) => {
    try {
        const packs = await prisma.productPack.findMany({
            where: { workspaceId: req.workspaceId },
            include: { items: true, _count: { select: { jobs: true } } },
            orderBy: { createdAt: 'desc' }
        });
        res.json(packs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/packs — create a pack
router.post('/', async (req, res) => {
    try {
        const { name, productTypes } = req.body;
        if (!name) return res.status(400).json({ error: 'Pack name required.' });
        if (!productTypes || !Array.isArray(productTypes) || productTypes.length === 0) {
            return res.status(400).json({ error: 'At least one product type required.' });
        }

        const pack = await productPackService.createPack(req.workspaceId, name, productTypes);
        res.json(pack);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/packs/:packId/run — run a design through the pack pipeline
router.post('/:packId/run', async (req, res) => {
    try {
        const { imageId } = req.body;
        const { packId } = req.params;
        if (!imageId) return res.status(400).json({ error: 'imageId required.' });

        const result = await productPackService.runPackPipeline(imageId, packId, req.workspaceId);
        res.json(result);
    } catch (err) {
        console.error('[PackPipeline]', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/packs/:packId — delete a pack
router.delete('/:packId', async (req, res) => {
    try {
        const { packId } = req.params;
        await prisma.productPackItem.deleteMany({ where: { packId } });
        await prisma.productPack.delete({ where: { id: packId } });
        res.json({ message: 'Pack deleted.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
