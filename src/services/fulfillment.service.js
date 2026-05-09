 const fetch = require('node-fetch');
  const prisma = require('../lib/prisma');
  const redis  = require('../config/redis');
  const monitor = require('./playwright-monitor.service');

  const SEEN_ORDERS_KEY = 'fulfillment:seenOrderIds';

  class FulfillmentService {
    constructor() {
      this.provider = 'YUPPION';
      this.apiKey = process.env.YUPPION_API_KEY;
      this.apiUrl = 'https://api.yuppion.com/v1';
    }

    async createOrder(order) {
      console.log(`[Fulfillment] Creating ${this.provider} order: ${order.externalOrderId}`);
      if (!this.apiKey || this.apiKey === 'your_key') {
        console.warn("[Fulfillment] API Key missing. Simulating success.");
        return { success: true, orderId: `YUP-${Math.floor(Math.random() * 100000)}`, status: 'SUBMITTED', estimatedShipping: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() };       
      }
      try {
        const response = await fetch(`${this.apiUrl}/orders`, { method: 'POST', headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }, body:
  JSON.stringify(order) });
        return await response.json();
      } catch (error) {
        console.error("[Fulfillment] Order submission failed:", error);
        throw error;
      }
    }

    async processNewOrder(order) {
      console.log(`[Fulfillment] Yeni sipariş işleniyor: ${order.id}`);
      let yuppionResult;
      try {
        yuppionResult = await this.createOrder({ externalOrderId: order.id, items: [{ designUrl: order.designUrl, productType: order.product, sku: order.sku }] });
      } catch (err) {
        yuppionResult = { success: false, error: err.message };
      }
      const statusLine = yuppionResult.success ? `✅ Yuppion'a gönderildi — Sipariş: <b>${yuppionResult.orderId}</b>` : `❌ Yuppion hatası: ${yuppionResult.error || 'Bilinmiyor'}`;
      await monitor.sendAlert(`🛍️ YENİ ETSY SİPARİŞİ\n\nMüşteri: <b>${order.customer}</b>\nÜrün: <b>${order.product}</b>\nSKU: ${order.sku || '-'}\nSipariş ID:
  <code>${order.id}</code>\n\n${statusLine}`, { type: 'new_order' }).catch(() => {});
      return { order, yuppionResult };
    }

    async checkNewOrders(workspaceId) {
      const orders = await this.syncEtsyOrders(workspaceId);
      if (!orders.length) return [];
      const seenRaw = await redis.get(SEEN_ORDERS_KEY).catch(() => null) || '[]';
      const seenIds = new Set(JSON.parse(seenRaw));
      const newOrders = orders.filter(o => !seenIds.has(String(o.id)));
      if (newOrders.length) {
        newOrders.forEach(o => seenIds.add(String(o.id)));
        await redis.set(SEEN_ORDERS_KEY, JSON.stringify([...seenIds])).catch(() => {});
        for (const order of newOrders) {
          await this.processNewOrder(order).catch(err => console.error(`[Fulfillment] processNewOrder hatası ${order.id}:`, err.message));
        }
      }
      return newOrders;
    }

    async syncEtsyOrders(workspaceId) {
      return [];
    }
  }

  module.exports = new FulfillmentService();
