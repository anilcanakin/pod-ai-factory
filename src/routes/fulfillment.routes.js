const express = require('express');
const router = express.Router();
const fulfillment = require('../services/fulfillment.service');
const catalog = require('../services/yuppion-catalog.service');

// ─── Orders ──────────────────────────────────────────────────────────────────

router.get('/orders', async (req, res) => {
    try {
        const orders = await fulfillment.syncEtsyOrders(req.workspaceId);
        res.json(orders);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/create', async (req, res) => {
    try {
        const result = await fulfillment.createOrder(req.body);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/notify-order', async (req, res) => {
    try {
        const result = await fulfillment.processNewOrder(req.body);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/check-new', async (req, res) => {
    try {
        const newOrders = await fulfillment.checkNewOrders(req.workspaceId);
        res.json({ success: true, newOrders, count: newOrders.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Yuppion Product Catalog ──────────────────────────────────────────────────

// GET /api/fulfillment/catalog — tüm ürünler + özet
router.get('/catalog', (req, res) => {
    try {
        const products = catalog.getProducts();
        const summary = catalog.getSummary();
        res.json({ summary, products });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/fulfillment/catalog/:modelId/colors — tek modelin renkleri
router.get('/catalog/:modelId/colors', (req, res) => {
    try {
        const data = catalog.getProductColors(req.params.modelId);
        if (!data) return res.status(404).json({ error: 'Model bulunamadı' });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/fulfillment/catalog/:modelId/colors — tek modelin renklerini güncelle
// Body: { colors: [{ name, hex, inStock? }] }
router.patch('/catalog/:modelId/colors', (req, res) => {
    try {
        const { colors } = req.body;
        if (!Array.isArray(colors)) return res.status(400).json({ error: 'colors dizisi gerekli' });
        const updated = catalog.updateModelColors(req.params.modelId, colors);
        res.json({ success: true, product: updated });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/fulfillment/catalog/import — JSON veya CSV ile toplu import
// JSON body: { format: 'json', products: [...] }
// JSON body: { format: 'csv', csv: 'modelId,colorName,hex,inStock\n...' }
router.post('/catalog/import', (req, res) => {
    try {
        const { format, products, csv } = req.body;

        if (format === 'csv' || csv) {
            const result = catalog.importFromCsv(csv || products);
            return res.json({ success: true, ...result });
        }

        if (format === 'json' || Array.isArray(products)) {
            const result = catalog.importFromJson(products);
            return res.json({ success: true, ...result });
        }

        res.status(400).json({ error: "format 'json' veya 'csv' olmalı" });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/fulfillment/catalog/:modelId/merge-colors
// Body: { colorNames: ['White', 'Black', ...] } — stokta olan renk isimlerini gönder
// Katalogdaki eksik renkleri out-of-stock yapar, yenileri ekler
router.post('/catalog/:modelId/merge-colors', (req, res) => {
    try {
        const { colorNames } = req.body;
        if (!Array.isArray(colorNames)) return res.status(400).json({ error: 'colorNames dizisi gerekli' });
        const updated = catalog.mergeModelColors(req.params.modelId, colorNames);
        res.json({ success: true, product: updated });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
