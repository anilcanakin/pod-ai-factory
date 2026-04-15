const express = require('express');
const router = express.Router();
const billingService = require('../services/billing.service');

// GET /api/billing/plans — list available plans
router.get('/plans', (req, res) => {
    res.json(billingService.getPlans());
});

// GET /api/billing/usage — current workspace usage
router.get('/usage', async (req, res) => {
    try {
        if (!req.workspaceId) return res.status(401).json({ error: 'Authentication required' });
        const usage = await billingService.checkUsageLimit(req.workspaceId);
        res.json(usage);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/billing/checkout — create Stripe checkout session
router.post('/checkout', async (req, res) => {
    try {
        if (!req.workspaceId) return res.status(401).json({ error: 'Authentication required' });
        const { planName } = req.body;
        if (!planName) return res.status(400).json({ error: 'planName required' });

        const result = await billingService.createCheckoutSession(req.workspaceId, planName);
        res.json(result);
    } catch (err) {
        console.error('[Billing Checkout]', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/billing/webhook — Stripe webhook handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const sig = req.headers['stripe-signature'];
        const stripe = billingService.getStripe();
        const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

        let event;
        if (stripe && endpointSecret && sig) {
            event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
        } else {
            // Dev mode: parse body directly
            event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        }

        await billingService.handleWebhookEvent(event);
        res.json({ received: true });
    } catch (err) {
        console.error('[Billing Webhook]', err);
        res.status(400).json({ error: err.message });
    }
});

// GET /api/billing/portal — redirect to Stripe customer portal
router.get('/portal', async (req, res) => {
    try {
        if (!req.workspaceId) return res.status(401).json({ error: 'Authentication required' });
        const result = await billingService.createPortalSession(req.workspaceId);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/billing/ai-spend — daily + monthly AI token spend (widget endpoint)
router.get('/ai-spend', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || null;
        const stats = await billingService.getDetailedStats(workspaceId);
        res.json(stats);
    } catch (err) {
        console.error('[Billing AI Spend]', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/billing/update-plan — manual plan update (dev/admin)
router.post('/update-plan', async (req, res) => {
    try {
        if (!req.workspaceId) return res.status(401).json({ error: 'Authentication required' });
        const { planName } = req.body;
        const result = await billingService.updatePlan(req.workspaceId, planName);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
