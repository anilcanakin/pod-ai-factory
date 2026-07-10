const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');

// Placeholder image for PENDING/FAILED (inline SVG as data URI)
const PLACEHOLDER_URL = 'data:image/svg+xml;base64,' + Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">' +
    '<rect width="400" height="400" fill="#1e293b"/>' +
    '<text x="200" y="190" font-family="monospace" font-size="14" fill="#475569" text-anchor="middle">Generating…</text>' +
    '<text x="200" y="215" font-family="monospace" font-size="11" fill="#334155" text-anchor="middle">PENDING</text>' +
    '</svg>'
).toString('base64');

const FAILED_PLACEHOLDER = 'data:image/svg+xml;base64,' + Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">' +
    '<rect width="400" height="400" fill="#1e293b"/>' +
    '<text x="200" y="190" font-family="monospace" font-size="14" fill="#ef4444" text-anchor="middle">Generation Failed</text>' +
    '<text x="200" y="215" font-family="monospace" font-size="11" fill="#7f1d1d" text-anchor="middle">FAILED</text>' +
    '</svg>'
).toString('base64');

// POST /api/gallery/save-mockup — save a rendered mockup URL as a GalleryImage record
router.post('/save-mockup', async (req, res) => {
    try {
        const { imageUrl, designImageId } = req.body;
        if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' });
        if (!req.workspaceId) return res.status(401).json({ error: 'Authentication required' });

        // Find or create a persistent "Mockup Gallery" job for this workspace
        let job = await prisma.designJob.findFirst({
            where: { workspaceId: req.workspaceId, mode: 'mockup_gallery' }
        });
        if (!job) {
            job = await prisma.designJob.create({
                data: {
                    workspaceId: req.workspaceId,
                    originalImage: 'mockup_gallery',
                    mode: 'mockup_gallery',
                    status: 'COMPLETED',
                    basePrompt: 'Mockup Gallery',
                }
            });
        }

        const image = await prisma.image.create({
            data: {
                jobId: job.id,
                variantType: 'mockup',
                promptUsed: 'Mockup render',
                engine: 'mockup',
                imageUrl,
                status: 'COMPLETED',
                isApproved: true,
                cost: 0,
                ...(designImageId ? { seed: designImageId } : {}),
            }
        });

        res.json({
            id: image.id,
            imageUrl: image.imageUrl,
            status: image.status,
            isApproved: image.isApproved,
            createdAt: image.createdAt,
        });
    } catch (err) {
        console.error('[Gallery save-mockup]', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/gallery/recent — latest 100 non-mockup images across all jobs (workspace-scoped)
router.get('/recent', async (req, res) => {
    try {
        const images = await prisma.image.findMany({
            where: {
                imageUrl: { not: 'PENDING' },
                engine: { notIn: ['mockup', 'bg_remove'] },
                job: { workspaceId: req.workspaceId },
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
            select: {
                id: true,
                imageUrl: true,
                status: true,
                isApproved: true,
                engine: true,
                seed: true,
                cost: true,
                createdAt: true,
                rawResponse: true,
                jobId: true,
                mockups: {
                    select: { id: true, mockupUrl: true, templateId: true },
                    take: 1,
                },
                seoData: {
                    select: { id: true, title: true, description: true, tags: true, etsyListingId: true },
                },
            },
        });

        // Pipeline mockuplarını Image tablosundan çek
        const jobIds = [...new Set(images.map(img => img.jobId).filter(Boolean))];
        const pipelineMockups = jobIds.length > 0 ? await prisma.image.findMany({
            where: { jobId: { in: jobIds }, engine: 'mockup' },
            select: { id: true, imageUrl: true, jobId: true },
            orderBy: { createdAt: 'desc' },
        }) : [];
        const mockupsByJobId = {};
        for (const m of pipelineMockups) {
            if (!mockupsByJobId[m.jobId]) mockupsByJobId[m.jobId] = [];
            mockupsByJobId[m.jobId].push({ id: m.id, mockupUrl: m.imageUrl, templateId: null });
        }
        const enriched = images.map(img => ({
            ...img,
            rawResponse: img.rawResponse ? img.rawResponse.substring(0, 300) : null,
            placeholderUrl: null,
            seoData: img.seoData
                ? { ...img.seoData, etsyListingId: img.seoData.etsyListingId ? img.seoData.etsyListingId.toString() : null }
                : null,
            mockups: (img.mockups && img.mockups.length > 0) ? img.mockups : (mockupsByJobId[img.jobId] || []),
        }));
        res.json(enriched);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/gallery/listings — images dispatched to Etsy (etsyListingId set)
router.get('/listings', async (req, res) => {
    try {
        const images = await prisma.image.findMany({
            where: {
                engine: { notIn: ['mockup', 'bg_remove'] },
                job: { workspaceId: req.workspaceId },
                seoData: { etsyListingId: { not: null } },
            },
            orderBy: { createdAt: 'desc' },
            take: 200,
            select: {
                id: true,
                imageUrl: true,
                status: true,
                isApproved: true,
                engine: true,
                seed: true,
                cost: true,
                createdAt: true,
                jobId: true,
                mockups: {
                    select: { id: true, mockupUrl: true, templateId: true },
                    take: 1,
                },
                seoData: {
                    select: { id: true, title: true, description: true, tags: true, etsyListingId: true },
                },
            },
        });

        // Pipeline mockuplarını Image tablosundan çek
        const jobIds = [...new Set(images.map(img => img.jobId).filter(Boolean))];
        const pipelineMockups = jobIds.length > 0 ? await prisma.image.findMany({
            where: { jobId: { in: jobIds }, engine: 'mockup' },
            select: { id: true, imageUrl: true, jobId: true },
            orderBy: { createdAt: 'desc' },
        }) : [];
        const mockupsByJobId = {};
        for (const m of pipelineMockups) {
            if (!mockupsByJobId[m.jobId]) mockupsByJobId[m.jobId] = [];
            mockupsByJobId[m.jobId].push({ id: m.id, mockupUrl: m.imageUrl, templateId: null });
        }
        const enriched = images.map(img => ({
            ...img,
            placeholderUrl: null,
            seoData: img.seoData
                ? { ...img.seoData, etsyListingId: img.seoData.etsyListingId ? img.seoData.etsyListingId.toString() : null }
                : null,
            mockups: (img.mockups && img.mockups.length > 0) ? img.mockups : (mockupsByJobId[img.jobId] || []),
        }));
        res.json(enriched);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/gallery/:jobId
router.get('/:jobId', async (req, res) => {
    try {
        const images = await prisma.image.findMany({
            where: {
                jobId: req.params.jobId,
                engine: { notIn: ['mockup', 'bg_remove'] },
            },
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                imageUrl: true,
                status: true,
                isApproved: true,
                engine: true,
                seed: true,
                cost: true,
                createdAt: true,
                rawResponse: true,
                jobId: true,
                mockups: {
                    select: { id: true, mockupUrl: true, templateId: true },
                    take: 5,
                },
                seoData: {
                    select: { id: true, title: true, description: true, tags: true, etsyListingId: true },
                },
            }
        });

        // Pipeline mockuplarını Image tablosundan çek
        const jobIds = [...new Set(images.map(img => img.jobId).filter(Boolean))];
        const pipelineMockups = jobIds.length > 0 ? await prisma.image.findMany({
            where: { jobId: { in: jobIds }, engine: 'mockup' },
            select: { id: true, imageUrl: true, jobId: true },
            orderBy: { createdAt: 'desc' },
        }) : [];
        const mockupsByJobId = {};
        for (const m of pipelineMockups) {
            if (!mockupsByJobId[m.jobId]) mockupsByJobId[m.jobId] = [];
            mockupsByJobId[m.jobId].push({ id: m.id, mockupUrl: m.imageUrl, templateId: null });
        }
        // Enrich each image: add placeholderUrl, truncate rawResponse
        const enriched = images.map(img => {
            const isPending = !img.imageUrl || img.imageUrl === 'PENDING';
            const isFailed = img.status === 'FAILED' || img.status === 'REJECTED';
            return {
                ...img,
                rawResponse: img.rawResponse ? img.rawResponse.substring(0, 300) : null,
                placeholderUrl: isPending
                    ? PLACEHOLDER_URL
                    : isFailed
                        ? FAILED_PLACEHOLDER
                        : null,
                seoData: img.seoData
                    ? { ...img.seoData, etsyListingId: img.seoData.etsyListingId ? img.seoData.etsyListingId.toString() : null }
                    : null,
                mockups: (img.mockups && img.mockups.length > 0) ? img.mockups : (mockupsByJobId[img.jobId] || []),
            };
        });
        res.json(enriched);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/gallery/:imageId/approve
router.post('/:imageId/approve', async (req, res) => {
    try {
        const image = await prisma.image.update({
            where: { id: req.params.imageId },
            data: { isApproved: true, status: 'APPROVED' }
        });
        res.json(image);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/gallery/:imageId/reject
router.post('/:imageId/reject', async (req, res) => {
    try {
        const image = await prisma.image.update({
            where: { id: req.params.imageId },
            data: { isApproved: false, status: 'REJECTED' }
        });
        res.json(image);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/gallery/:imageId — delete an image record
router.delete('/:imageId', async (req, res) => {
    try {
        const { imageId } = req.params;
        if (!req.workspaceId) return res.status(401).json({ error: 'Unauthorized' });

        const image = await prisma.image.findFirst({
            where: { id: imageId },
            include: { job: true },
        });

        if (!image) return res.status(404).json({ error: 'Image not found' });
        if (image.job.workspaceId !== req.workspaceId) return res.status(403).json({ error: 'Forbidden' });

        await prisma.image.delete({ where: { id: imageId } });
        res.json({ success: true });
    } catch (err) {
        console.error('[Gallery DELETE]', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/gallery/:imageId/regenerate — reset to PENDING for re-generation
router.post('/:imageId/regenerate', async (req, res) => {
    try {
        const image = await prisma.image.update({
            where: { id: req.params.imageId },
            data: { imageUrl: 'PENDING', status: 'GENERATED', isApproved: false, cost: 0 }
        });
        res.json({ message: 'Image reset to PENDING. Run factory again to regenerate.', image });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
