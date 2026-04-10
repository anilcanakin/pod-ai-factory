const express = require('express');
const router = express.Router();
const fulfillment = require('../services/fulfillment.service');

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

module.exports = router;
