const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { createObjectCsvWriter } = require('csv-writer');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const prisma = new PrismaClient();

// POST /api/export/etsy
router.post('/etsy', async (req, res) => {
    try {
        const { jobId } = req.body;
        if (!jobId) return res.status(400).json({ error: "Job ID required." });

        const images = await prisma.image.findMany({
            where: { jobId: jobId, status: { in: ['PROCESSED', 'COMPLETED', 'APPROVED'] }, job: { workspaceId: req.workspaceId } },
            include: { mockups: true, seoData: true }
        });

        if (!images || images.length === 0) {
            return res.status(404).json({ error: "No PROCESSED images found for export." });
        }

        const variations = [
            { color: "Black", size: "S" }, { color: "Black", size: "M" }, { color: "Black", size: "L" },
            { color: "Navy", size: "S" }, { color: "Navy", size: "M" }, { color: "Navy", size: "L" },
            { color: "White", size: "S" }, { color: "White", size: "M" }, { color: "White", size: "L" },
        ];

        const csvPath = path.join(__dirname, `../../assets/outputs/${jobId}_etsy.csv`);
        const csvWriter = createObjectCsvWriter({
            path: csvPath,
            header: [
                { id: 'title', title: 'Title' },
                { id: 'description', title: 'Description' },
                { id: 'price', title: 'Price' },
                { id: 'quantity', title: 'Quantity' },
                { id: 'tags', title: 'Tags' },
                { id: 'sku', title: 'SKU' },
                { id: 'image1', title: 'Image1' },
                { id: 'image2', title: 'Image2' },
                { id: 'image3', title: 'Image3' },
            ]
        });

        const records = [];

        for (const img of images) {
            if (!img.seoData) continue;

            const baseSku = img.id.substring(0, 8).toUpperCase();
            const mockupUrls = img.mockups.map(m => m.mockupUrl);
            const m1 = mockupUrls[0] || '';
            const m2 = mockupUrls[1] || '';
            const m3 = mockupUrls[2] || '';
            const tagsStr = (img.seoData.tags || []).join(', ');

            for (const v of variations) {
                records.push({
                    title: img.seoData.title,
                    description: img.seoData.description,
                    price: "24.99",
                    quantity: "999",
                    tags: tagsStr,
                    sku: `${baseSku}-${v.color.toUpperCase()}-${v.size}`,
                    image1: m1,
                    image2: m2,
                    image3: m3
                });
            }
        }

        if (records.length === 0) {
            return res.status(400).json({ error: "No exportable records found (missing SEO data?)." });
        }

        await csvWriter.writeRecords(records);
        res.json({ message: "Export successful", fileUrl: `assets/outputs/${jobId}_etsy.csv` });

    } catch (err) {
        console.error('Export error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/export/job/:jobId/bundle
// Structured ZIP: designs/, mockups/, seo/, listing.csv
router.get('/job/:jobId/bundle', async (req, res) => {
    try {
        const { jobId } = req.params;
        const images = await prisma.image.findMany({
            where: { jobId, status: { in: ['PROCESSED', 'COMPLETED', 'APPROVED'] }, job: { workspaceId: req.workspaceId } },
            include: { mockups: true, seoData: true }
        });

        if (images.length === 0) return res.status(404).json({ error: "No PROCESSED data found." });

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-disposition', `attachment; filename=bundle_${jobId}.zip`);

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.on('error', err => { throw err; });
        archive.pipe(res);

        // Listing CSV
        const csvPath = path.join(__dirname, `../../assets/outputs/${jobId}_etsy.csv`);
        if (fs.existsSync(csvPath)) {
            archive.file(csvPath, { name: 'listing.csv' });
        }

        const seoCollection = [];
        let designIdx = 0;
        let mockupIdx = 0;

        for (const img of images) {
            if (img.seoData) seoCollection.push(img.seoData);

            // Designs → designs/ folder
            if (img.masterFileUrl) {
                const masterPath = path.join(__dirname, '../../', img.masterFileUrl);
                if (fs.existsSync(masterPath)) {
                    designIdx++;
                    archive.file(masterPath, { name: `designs/design_${designIdx}_4500x5400.png` });
                }
            }

            // Mockups → mockups/ folder with descriptive names
            for (const m of img.mockups) {
                const mockupPath = path.join(__dirname, '../../', m.mockupUrl);
                if (fs.existsSync(mockupPath)) {
                    mockupIdx++;
                    // Extract category-name from mockupUrl if available, otherwise generic
                    const basename = path.basename(m.mockupUrl);
                    archive.file(mockupPath, { name: `mockups/${basename}` });
                }
            }
        }

        // SEO JSON → seo/ folder
        archive.append(JSON.stringify(seoCollection, null, 2), { name: 'seo/seo.json' });

        await archive.finalize();

    } catch (err) {
        console.error('Bundle Export error:', err);
        if (!res.headersSent) res.status(500).json({ error: err.message });
    }
});

module.exports = router;
