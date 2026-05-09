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


 router.post('/synthesize', async (req, res) => {
      try {
          const workspaceId = req.workspaceId;
          const performers = await prisma.productPerformance.findMany({
              where: { image: { job: { workspaceId } }, OR: [{ flag: 'WINNER' }, { score: { gte: 40 } }] },
              orderBy: { score: 'desc' }, take: 10,
              include: { image: { include: { seoData: true, job: { select: { keyword: true, niche: true, style: true } } } } }
          });
          if (!performers.length) return res.json({ success: false, message: 'Analiz icin yeterli veri yok.' });
          const lines = performers.map((p, i) => {
              const job = p.image && p.image.job;
              const seo = p.image && p.image.seoData;
              const ctr = p.impressions > 0 ? ((p.visits / p.impressions) * 100).toFixed(1) : '0';
              return (i + 1) + '. ' + ((job && job.niche) || (job && job.keyword) || '?') + ' | ' + ((job && job.style) || '?') + ' | Score:' + p.score + ' CTR:' + ctr + '% Orders:' + p.orders + ' | ' + ((seo && seo.title && seo.title.slice(0, 60)) || '-');
          });
          const summary = lines.join(' --- ');
          const anthropic = require('../lib/anthropic');
          const response = await anthropic.messages.create({
              model: 'claude-haiku-4-5-20251001', max_tokens: 800,
              messages: [{ role: 'user', content: 'Etsy POD top performer analizi: ' + summary + ' -- Hangi nis/stil calisiyor, 3 oneri ver, bullet-point.' }]
          });
          const insight = response.content[0].text;
          await prisma.corporateMemory.create({ data: { workspaceId, type: 'auto_analysis', title: 'Analytics Feedback ' + new Date().toLocaleDateString('tr-TR'), content: insight, category:      
  'pod_apparel', isActive: true, analysisResult: { synthesis: insight } } });
          res.json({ success: true, insight, performersAnalyzed: performers.length });
      } catch (err) {
          res.status(500).json({ error: err.message });
      }
  });

  module.exports = router;
