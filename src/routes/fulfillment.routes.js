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

// Manuel tetikleyici — tek bir siparişi işle + Telegram + Yuppion
router.post('/notify-order', async (req, res) => {
    try {
        const result = await fulfillment.processNewOrder(req.body);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Etsy'deki yeni siparişleri kontrol et (polling tetikleyici)
router.post('/check-new', async (req, res) => {
    try {
        const newOrders = await fulfillment.checkNewOrders(req.workspaceId);
        res.json({ success: true, newOrders, count: newOrders.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

  router.post('/notify-order', async (req, res) => {
      try { const result = await fulfillment.processNewOrder(req.body); res.json({ success: true, ...result }); }
      catch (err) { res.status(500).json({ error: err.message }); }
  });
  router.post('/check-new', async (req, res) => {
      try { const newOrders = await fulfillment.checkNewOrders(req.workspaceId); res.json({ success: true, newOrders, count: newOrders.length }); }
      catch (err) { res.status(500).json({ error: err.message }); }
  });
module.exports = router;
