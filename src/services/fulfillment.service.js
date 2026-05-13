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

  /**
   * createOrder
   * Submits a new POD order to the factory
   * @param {Object} order - { externalOrderId, items: [{ designUrl, productType, color, size }] }
   */
  async createOrder(order) {
    console.log(`[Fulfillment] Creating ${this.provider} order: ${order.externalOrderId}`);

    // Stub for real API call
    if (!this.apiKey || this.apiKey === 'your_key') {
      console.warn("[Fulfillment] API Key missing. Simulating success for production testing.");
      return {
        success: true,
        orderId: `YUP-${Math.floor(Math.random() * 100000)}`,
        status: 'SUBMITTED',
        estimatedShipping: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      };
    }

    try {
      const response = await fetch(`${this.apiUrl}/orders`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(order)
      });

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("[Fulfillment] Order submission failed:", error);
      throw error;
    }
  }

  /**
   * processNewOrder
   * Yuppion'a gönderir + Telegram bildirimi yollar.
   */
  async processNewOrder(order) {
    console.log(`[Fulfillment] Yeni sipariş işleniyor: ${order.id}`);

    let yuppionResult;
    try {
      yuppionResult = await this.createOrder({
        externalOrderId: order.id,
        items: [{ designUrl: order.designUrl, productType: order.product, sku: order.sku }]
      });
    } catch (err) {
      yuppionResult = { success: false, error: err.message };
    }

    const statusLine = yuppionResult.success
      ? `✅ Yuppion'a gönderildi — Sipariş: <b>${yuppionResult.orderId}</b>`
      : `❌ Yuppion hatası: ${yuppionResult.error || 'Bilinmiyor'}`;

    await monitor.sendAlert(
      `🛍️ YENİ ETSY SİPARİŞİ\n\n` +
      `Müşteri: <b>${order.customer}</b>\n` +
      `Ürün: <b>${order.product}</b>\n` +
      `SKU: ${order.sku || '-'}\n` +
      `Sipariş ID: <code>${order.id}</code>\n\n` +
      statusLine,
      { type: 'new_order' }
    ).catch(() => {});

    return { order, yuppionResult };
  }

  /**
   * checkNewOrders
   * syncEtsyOrders çıktısını Redis'teki görülmüş ID listesiyle karşılaştırır.
   * Yeni olanlar için processNewOrder() çağırır.
   */
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
        await this.processNewOrder(order).catch(err =>
          console.error(`[Fulfillment] processNewOrder hatası ${order.id}:`, err.message)
        );
      }
    }

    return newOrders;
  }

  /**
   * syncEtsyOrders
   * Etsy API onaylandığında burası gerçek OAuth çağrısıyla değiştirilecek.
   */
  async syncEtsyOrders(workspaceId) {
    return [];
  }
}

module.exports = new FulfillmentService();
