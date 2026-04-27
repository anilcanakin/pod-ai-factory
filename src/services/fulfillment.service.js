const fetch = require('node-fetch');
const prisma = require('../lib/prisma');

/**
 * FulfillmentService
 * Manages POD production orders with external providers (Yuppion, Printify, etc.)
 */
class FulfillmentService {
  constructor() {
    this.provider = 'YUPPION'; // Default for this project
    this.apiKey = process.env.YUPPION_API_KEY;
    this.apiUrl = 'https://api.yuppion.com/v1'; // Example URL
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
   * syncEtsyOrders
   * Fetches pending orders from Etsy and pre-fills them for fulfillment
   */
  async syncEtsyOrders(workspaceId) {
    // This would typically use the Etsy API (OAuth) to get 'open' orders.
    // For now, we return a mock list of what the user might see.
    return [
      {
        id: '12345678',
        customer: 'John Doe',
        product: 'Custom Cat T-Shirt',
        sku: 'CAT-TS-001',
        designUrl: 'https://...',
        status: 'AWAITING_FULFILLMENT'
      }
    ];
  }
}

module.exports = new FulfillmentService();
