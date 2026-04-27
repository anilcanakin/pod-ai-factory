const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'assets/uploads/' });
const csv = require('csv-parser');
const fs = require('fs');
const analyticsService = require('../services/analytics.service');

const prisma = require('../lib/prisma');

// POST /api/analytics/import
// Accepts Etsy CSV analytics
router.post('/import', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Upload an Etsy Analytics CSV file." });

        let processedCount = 0;
        const rows = [];

        await new Promise((resolve, reject) => {
            fs.createReadStream(req.file.path)
                .pipe(csv())
                .on('data', (data) => rows.push(data))
                .on('end', () => resolve())
                .on('error', reject);
        });

        for (const data of rows) {
            try {
                const perf = await analyticsService.processRow(data);
                if (perf) processedCount++;
            } catch (e) {
                console.error("Error processing analytics row:", e);
            }
        }

        res.json({ message: `Successfully processed ${processedCount} rows of analytics data.` });

    } catch (err) {
        console.error('Analytics Import error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/analytics/performance
router.get('/performance', async (req, res) => {
    try {
        const performances = await prisma.productPerformance.findMany({
            orderBy: { score: 'desc' },
            include: {
                // Include Image status if available
                image: {
                    select: { imageUrl: true, status: true }
                }
            }
        });

        // Map to flat structure for UI
        const results = performances.map(p => ({
            id: p.id,
            imageId: p.imageId,
            sku: p.sku,
            impressions: p.impressions,
            visits: p.visits,
            favorites: p.favorites,
            orders: p.orders,
            score: p.score,
            flag: p.flag,
            imageUrl: p.image?.imageUrl || null,
            imageStatus: p.image?.status || 'UNKNOWN'
        }));

        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
