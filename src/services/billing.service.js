const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class BillingService {
    // AI Provider Pricing (per token)
    static PRICES = {
        // Google Gemini — https://ai.google.dev/pricing
        'gemini-1.5-flash':  { input: 0.075  / 1_000_000, output: 0.30  / 1_000_000 },
        'gemini-2.0-flash':  { input: 0.10   / 1_000_000, output: 0.40  / 1_000_000 },
        'gemini-1.5-pro':    { input: 1.25   / 1_000_000, output: 5.00  / 1_000_000 },
        // Anthropic Claude — https://www.anthropic.com/pricing
        'claude-haiku-4-5':  { input: 0.80   / 1_000_000, output: 4.00  / 1_000_000 },
        'claude-haiku-3-5':  { input: 0.80   / 1_000_000, output: 4.00  / 1_000_000 },
        'claude-sonnet-4-5': { input: 3.00   / 1_000_000, output: 15.00 / 1_000_000 },
        'claude-sonnet-4-6': { input: 3.00   / 1_000_000, output: 15.00 / 1_000_000 },
        'claude-opus-4-6':   { input: 15.00  / 1_000_000, output: 75.00 / 1_000_000 },
        // OpenAI
        'gpt-4o':            { input: 2.50   / 1_000_000, output: 10.00 / 1_000_000 },
        'gpt-4o-mini':       { input: 0.15   / 1_000_000, output: 0.60  / 1_000_000 },
    };

    // Back-compat alias (Gemini only)
    static GEMINI_PRICES = {
        'gemini-1.5-flash': { input: 0.075 / 1_000_000, output: 0.30 / 1_000_000 }
    };

    /**
     * Log API Usage to Database.
     * Accepts both Gemini usageMetadata shape and Anthropic usage shape.
     */
    async logUsage(provider, modelName, usageMetadata, workspaceId = 'default-workspace', metadata = {}) {
        try {
            // Gemini: promptTokenCount / candidatesTokenCount
            // Anthropic SDK: input_tokens / output_tokens
            const inputTokens  = usageMetadata.promptTokenCount  || usageMetadata.input_tokens  || usageMetadata.inputTokens  || 0;
            const outputTokens = usageMetadata.candidatesTokenCount || usageMetadata.output_tokens || usageMetadata.outputTokens || 0;

            const prices = BillingService.PRICES[modelName];
            const cost = prices
                ? (inputTokens * prices.input) + (outputTokens * prices.output)
                : 0;

            const log = await prisma.apiUsage.create({
                data: {
                    workspaceId,
                    provider,
                    modelName,
                    inputTokens,
                    outputTokens,
                    cost,
                    metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : null
                }
            });

            console.log(`[Billing] ${provider}/${modelName} → $${cost.toFixed(6)} (${inputTokens}↑ ${outputTokens}↓ tokens)`);
            return log;
        } catch (err) {
            console.error('[Billing] Failed to log usage:', err.message);
            return null;
        }
    }

    /**
     * Get Billing Stats (Daily & Monthly)
     */
    async getStats(workspaceId = 'default-workspace') {
        const now = new Date();
        
        // Daily Start (00:00:00)
        const dayStart = new Date(now);
        dayStart.setHours(0, 0, 0, 0);

        // Monthly Start (1st of month 00:00:00)
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        const [dailyResult, monthlyResult] = await Promise.all([
            prisma.apiUsage.aggregate({
                where: {
                    workspaceId,
                    createdAt: { gte: dayStart }
                },
                _sum: { cost: true }
            }),
            prisma.apiUsage.aggregate({
                where: {
                    workspaceId,
                    createdAt: { gte: monthStart }
                },
                _sum: { cost: true }
            })
        ]);

        return {
            dailySpend: Number(dailyResult._sum.cost || 0),
            monthlySpend: Number(monthlyResult._sum.cost || 0),
            currency: 'USD'
        };
    }

    /**
     * Detailed breakdown by provider for the dashboard widget.
     */
    async getDetailedStats(workspaceId = 'default-workspace') {
        const now = new Date();
        const dayStart = new Date(now);
        dayStart.setHours(0, 0, 0, 0);
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        const where = (start) => ({
            ...(workspaceId ? { workspaceId } : {}),
            createdAt: { gte: start }
        });

        const [daily, monthly, dailyByProvider, monthlyByProvider, recentLogs] = await Promise.all([
            prisma.apiUsage.aggregate({ where: where(dayStart),   _sum: { cost: true, inputTokens: true, outputTokens: true } }),
            prisma.apiUsage.aggregate({ where: where(monthStart), _sum: { cost: true, inputTokens: true, outputTokens: true } }),
            prisma.apiUsage.groupBy({
                by: ['provider'],
                where: where(dayStart),
                _sum: { cost: true }
            }),
            prisma.apiUsage.groupBy({
                by: ['provider'],
                where: where(monthStart),
                _sum: { cost: true }
            }),
            // Last 20 usage events for live feed
            prisma.apiUsage.findMany({
                where: workspaceId ? { workspaceId } : {},
                orderBy: { createdAt: 'desc' },
                take: 20,
                select: { provider: true, modelName: true, cost: true, inputTokens: true, outputTokens: true, createdAt: true, metadata: true }
            })
        ]);

        const toMap = (rows) => rows.reduce((acc, r) => {
            acc[r.provider] = Number(r._sum.cost || 0);
            return acc;
        }, {});

        return {
            dailySpend:    Number(daily._sum.cost   || 0),
            monthlySpend:  Number(monthly._sum.cost || 0),
            dailyTokens:   { input: daily._sum.inputTokens || 0,   output: daily._sum.outputTokens || 0 },
            monthlyTokens: { input: monthly._sum.inputTokens || 0, output: monthly._sum.outputTokens || 0 },
            dailyByProvider:   toMap(dailyByProvider),
            monthlyByProvider: toMap(monthlyByProvider),
            recentLogs,
            currency: 'USD',
            resetAt: new Date(new Date().setHours(24, 0, 0, 0)).toISOString()
        };
    }
}

module.exports = new BillingService();
