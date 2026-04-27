const express      = require('express');
const router       = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma       = new PrismaClient();
const { getFinancialSummary, recordIncome } = require('../services/finance.service');

// GET /api/finance/summary — Overview dashboard için mali özet
router.get('/summary', async (req, res) => {
    try {
        const summary = await getFinancialSummary(req.workspaceId);
        res.json(summary);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/finance/income — Manuel Etsy satış kaydı
router.post('/income', async (req, res) => {
    const { amount, description, imageId } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'amount gerekli' });
    try {
        await recordIncome(req.workspaceId, {
            amount,
            description: description || 'Etsy satış geliri',
            imageId:     imageId || null,
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/finance/niche-roi — Niş bazında ROI analizi
router.get('/niche-roi', async (req, res) => {
    try {
        const listingPrice = parseFloat(process.env.DEFAULT_LISTING_PRICE || '19.99');
        const rows = await prisma.$queryRawUnsafe(`
            SELECT
                COALESCE(NULLIF(j.niche, ''), NULLIF(j.keyword, ''), 'Diğer') AS niche,
                COUNT(DISTINCT j.id)::int                                       AS job_count,
                COUNT(i.id)::int                                                AS image_count,
                COALESCE(SUM(i.cost), 0)                                       AS total_cost,
                COUNT(CASE WHEN i."isApproved" = true THEN 1 END)::int         AS approved_count
            FROM "DesignJob" j
            LEFT JOIN "Image" i ON i."jobId" = j.id
            WHERE j."workspaceId" = $1
              AND (j.niche IS NOT NULL OR j.keyword IS NOT NULL)
            GROUP BY COALESCE(NULLIF(j.niche, ''), NULLIF(j.keyword, ''), 'Diğer')
            ORDER BY total_cost DESC
            LIMIT 8
        `, req.workspaceId);

        const niches = rows.map(r => {
            const cost     = parseFloat(r.total_cost);
            const approved = parseInt(r.approved_count);
            const revenue  = approved * listingPrice;
            return {
                niche:             r.niche,
                jobCount:          parseInt(r.job_count),
                imageCount:        parseInt(r.image_count),
                totalCost:         +cost.toFixed(4),
                approvedCount:     approved,
                estimatedRevenue:  +revenue.toFixed(2),
                roi:               cost > 0 ? +(revenue / cost).toFixed(1) : null,
            };
        });

        res.json({ niches, listingPrice });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
