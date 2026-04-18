const express             = require('express');
const router              = express.Router();
const apify               = require('../services/apify.service');
const { ApifyPaymentError, X402ConfigError } = require('../services/apify.service');

/**
 * POST /api/apify/etsy-products
 * Body: { keyword, maxResults? }
 */
router.post('/etsy-products', async (req, res) => {
    try {
        const { keyword, maxResults = 25 } = req.body;
        if (!keyword) return res.status(400).json({ error: 'keyword is required' });
        const products = await apify.scrapeEtsyProducts(keyword, maxResults);
        // X402ConfigError ve ApifyPaymentError burada hiç gelmez:
        // scrapeEtsyProducts otomatik fallback'e geçer ve veri döner.
        res.json({ success: true, count: products.length, products });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/apify/pinterest-trends
 * Body: { keyword, maxResults?, save? }
 * save=true → also persists VISUAL_TRENDS to CorporateMemory
 */
router.post('/pinterest-trends', async (req, res) => {
    try {
        const { keyword, maxResults = 20, save = false } = req.body;
        const workspaceId = req.workspaceId || 'default-workspace';
        if (!keyword) return res.status(400).json({ error: 'keyword is required' });

        if (save) {
            const { trends, saved } = await apify.scrapePinterestTrendsAndSave(keyword, workspaceId, maxResults);
            return res.json({ success: true, count: trends.length, savedToKnowledge: saved, trends });
        }

        const trends = await apify.scrapePinterestTrends(keyword, maxResults);
        res.json({ success: true, count: trends.length, trends });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/apify/keywords
 * Body: { keywords: string | string[], countryCode? }
 */
router.post('/keywords', async (req, res) => {
    try {
        const { keywords, countryCode = 'US' } = req.body;
        if (!keywords) return res.status(400).json({ error: 'keywords is required' });
        const results = await apify.researchEtsyKeywords(keywords, countryCode);
        const hasRealVolume = results.some(r => r.source === 'apify_keywords_tool');
        res.json({ success: true, count: results.length, hasRealVolume, results });
    } catch (err) {
        if (err instanceof ApifyPaymentError) {
            return res.status(402).json({
                error: 'x402_payment_required',
                message: err.message,
                fix: 'Set APIFY_ACTOR_KEYWORDS env var to an actor you have access to, or configure x402 payment.',
            });
        }
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/apify/competitor-context
 * Body: { keywords: string[] }
 * Returns a compact competitor snapshot used by the audit
 */
router.post('/competitor-context', async (req, res) => {
    try {
        const { keywords = [] } = req.body;
        const context = await apify.fetchCompetitorContext(keywords);
        res.json({ success: true, ...context });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/apify/trends-2026
 * Body: { workspaceId? }
 * Fetches live Etsy data for all 2026 trend keywords and saves to Knowledge.
 * Requires X402_WALLET_PRIVATE_KEY (USDC on Base for shahidirfan/etsy-scraper).
 */
router.post('/trends-2026', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || req.body.workspaceId || 'default-workspace';
        const results = await apify.fetch2026Trends(workspaceId);
        const saved   = results.filter(r => r.saved).length;
        const failed  = results.filter(r => r.error).length;
        res.json({ success: true, total: results.length, saved, failed, results });
    } catch (err) {
        if (err instanceof X402ConfigError) {
            return res.status(400).json({
                error: 'x402_config_missing',
                message: err.message,
                fix: 'Add X402_WALLET_PRIVATE_KEY to .env (Base wallet with USDC balance).',
            });
        }
        if (err instanceof ApifyPaymentError) {
            return res.status(402).json({
                error: 'x402_payment_failed',
                message: err.message,
                fix: 'Ensure your Base wallet has enough USDC and X402_WALLET_PRIVATE_KEY is correct.',
            });
        }
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/apify/trends-2026/list
 * Returns the TRENDS_2026 keyword list (no scraping, just the config).
 */
router.get('/trends-2026/list', (req, res) => {
    res.json({ success: true, trends: apify.TRENDS_2026 });
});

module.exports = router;
