const billingService = require('../services/billing.service');

/**
 * Usage enforcement middleware
 * 
 * Apply to routes that consume design generation credits.
 * Returns 402 (Payment Required) when the workspace has exceeded its plan limit.
 */
async function usageMiddleware(req, res, next) {
    try {
        if (!req.workspaceId) return next(); // Let auth middleware handle missing workspace

        const usage = await billingService.checkUsageLimit(req.workspaceId);

        // Attach usage info to request for downstream handlers
        req.planUsage = usage;

        if (usage.isOverLimit) {
            return res.status(402).json({
                error: `Plan limit reached. Your ${usage.planName} plan allows ${usage.planLimit} designs/month. Used: ${usage.monthlyUsage}. Please upgrade.`,
                code: 'PLAN_LIMIT_EXCEEDED',
                usage
            });
        }

        next();
    } catch (err) {
        console.error('[UsageMiddleware]', err);
        next(); // Don't block on billing errors in dev
    }
}

module.exports = usageMiddleware;
