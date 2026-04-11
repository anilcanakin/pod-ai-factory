const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Plan definitions
 */
const PLANS = {
    starter: {
        name: 'Starter',
        limit: 50,
        priceMonthly: 19,
        stripePriceId: process.env.STRIPE_PRICE_STARTER || 'price_starter_placeholder',
        features: ['50 designs / month', 'Standard mockups', 'SEO generation', 'CSV export']
    },
    pro: {
        name: 'Pro',
        limit: 300,
        priceMonthly: 49,
        stripePriceId: process.env.STRIPE_PRICE_PRO || 'price_pro_placeholder',
        features: ['300 designs / month', 'All mockup types', 'SEO generation', 'CSV export', 'Product Packs', 'Priority support']
    },
    unlimited: {
        name: 'Unlimited',
        limit: 999999,
        priceMonthly: 99,
        stripePriceId: process.env.STRIPE_PRICE_UNLIMITED || 'price_unlimited_placeholder',
        features: ['Unlimited designs', 'All mockup types', 'SEO generation', 'CSV export', 'Product Packs', 'Etsy Mode', 'Priority support', 'API access']
    }
};

class BillingService {

    getPlans() {
        return Object.entries(PLANS).map(([key, plan]) => ({
            id: key,
            ...plan
        }));
    }

    getPlan(planName) {
        return PLANS[planName] || PLANS.starter;
    }

    /**
     * Check if workspace has usage remaining
     */
    async checkUsageLimit(workspaceId) {
        const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
        if (!workspace) throw new Error('Workspace not found');

        // Auto-reset monthly usage if needed
        await this.checkAndResetMonthly(workspace);

        const plan = this.getPlan(workspace.planName);
        const remaining = plan.limit - workspace.monthlyUsage;

        return {
            planName: workspace.planName,
            planLimit: plan.limit,
            monthlyUsage: workspace.monthlyUsage,
            remaining: Math.max(0, remaining),
            isOverLimit: workspace.monthlyUsage >= plan.limit,
            resetDate: workspace.usageResetDate
        };
    }

    /**
     * Increment usage counter
     */
    async incrementUsage(workspaceId, count = 1) {
        await prisma.workspace.update({
            where: { id: workspaceId },
            data: { monthlyUsage: { increment: count } }
        });
    }

    /**
     * Reset monthly usage if we've crossed into a new month
     */
    async checkAndResetMonthly(workspace) {
        const now = new Date();
        const resetDate = new Date(workspace.usageResetDate);

        // Check if we need to reset (1st of the month)
        if (now.getMonth() !== resetDate.getMonth() || now.getFullYear() !== resetDate.getFullYear()) {
            await prisma.workspace.update({
                where: { id: workspace.id },
                data: {
                    monthlyUsage: 0,
                    usageResetDate: new Date(now.getFullYear(), now.getMonth(), 1)
                }
            });
        }
    }

    /**
     * Update workspace plan (called after successful Stripe checkout)
     */
    async updatePlan(workspaceId, planName) {
        const plan = this.getPlan(planName);
        if (!plan) throw new Error(`Unknown plan: ${planName}`);

        await prisma.workspace.update({
            where: { id: workspaceId },
            data: {
                planName,
                planLimit: plan.limit
            }
        });

        return { planName, planLimit: plan.limit };
    }

    /**
     * Create Stripe checkout session (requires stripe npm package)
     */
    async createCheckoutSession(workspaceId, planName) {
        const stripe = this.getStripe();
        if (!stripe) {
            const base = process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
            return {
                url: `${base}/dashboard/billing?mock_checkout=true&plan=${planName}`,
                mock: true
            };
        }

        const plan = this.getPlan(planName);
        const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });

        let customerId = workspace.stripeCustomerId;
        if (!customerId) {
            const customer = await stripe.customers.create({
                metadata: { workspaceId }
            });
            customerId = customer.id;
            await prisma.workspace.update({
                where: { id: workspaceId },
                data: { stripeCustomerId: customerId }
            });
        }

        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            payment_method_types: ['card'],
            mode: 'subscription',
            line_items: [{ price: plan.stripePriceId, quantity: 1 }],
            success_url: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/dashboard/billing?success=true`,
            cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/dashboard/billing?canceled=true`,
            metadata: { workspaceId, planName }
        });

        return { url: session.url, sessionId: session.id };
    }

    /**
     * Handle Stripe webhook event
     */
    async handleWebhookEvent(event) {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const { workspaceId, planName } = session.metadata;
                if (workspaceId && planName) {
                    await this.updatePlan(workspaceId, planName);
                    await prisma.workspace.update({
                        where: { id: workspaceId },
                        data: { stripeSubscriptionId: session.subscription }
                    });
                }
                break;
            }
            case 'customer.subscription.deleted': {
                const subscription = event.data.object;
                const workspace = await prisma.workspace.findFirst({
                    where: { stripeSubscriptionId: subscription.id }
                });
                if (workspace) {
                    await this.updatePlan(workspace.id, 'starter');
                    await prisma.workspace.update({
                        where: { id: workspace.id },
                        data: { stripeSubscriptionId: null }
                    });
                }
                break;
            }
        }
    }

    /**
     * Create Stripe customer portal session
     */
    async createPortalSession(workspaceId) {
        const stripe = this.getStripe();
        const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });

        if (!workspace?.stripeCustomerId || !stripe) {
            const base = process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
            return { url: `${base}/dashboard/billing?portal=mock`, mock: true };
        }

        const session = await stripe.billingPortal.sessions.create({
            customer: workspace.stripeCustomerId,
            return_url: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/dashboard/billing`
        });

        return { url: session.url };
    }

    getStripe() {
        const key = process.env.STRIPE_SECRET_KEY;
        if (!key || key === 'your_stripe_secret_key' || key.length < 10) {
            console.warn('[Billing] Stripe is not configured, using mock URLs. Set STRIPE_SECRET_KEY to enable real payments.');
            return null;
        }
        try {
            return require('stripe')(key);
        } catch {
            console.warn('[Billing] Failed to load Stripe SDK, using mock URLs.');
            return null;
        }
    }
}

module.exports = new BillingService();
