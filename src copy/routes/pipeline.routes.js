const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { processAsset } = require('../queues/asset.worker');
const { assetQueue } = require('../queues/index');

const prisma = new PrismaClient();

// POST /api/pipeline/run — single image pipeline trigger
router.post('/run', async (req, res) => {
    try {
        const { imageId } = req.body;
        if (!imageId) return res.status(400).json({ error: 'imageId is required' });

        const image = await prisma.image.findFirst({ where: { id: imageId, job: { workspaceId: req.workspaceId } } });
        if (!image) return res.status(404).json({ error: 'Image not found.' });
        if (!['APPROVED', 'PROCESSED', 'COMPLETED'].includes(image.status) && !image.isApproved) {
            return res.status(400).json({ error: 'Only APPROVED images can enter the pipeline.' });
        }

        console.log(`[Pipeline] Starting for image: ${imageId} via BullMQ`);
        await assetQueue.add('processAsset', { imageId }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 }
        });

        const updated = await prisma.image.findUnique({ where: { id: imageId } });
        res.json({ message: 'Asset pipeline completed.', imageId, status: updated?.status });
    } catch (err) {
        console.error('[Pipeline /run]', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/pipeline/run-job/:jobId — process ALL approved images for a job (idempotent)
router.post('/run-job/:jobId', async (req, res) => {
    const { jobId } = req.params;
    try {
        const approvedImages = await prisma.image.findMany({
            where: {
                jobId,
                job: { workspaceId: req.workspaceId },
                OR: [
                    { isApproved: true },
                    { status: 'APPROVED' }
                ]
            }
        });

        if (approvedImages.length === 0) {
            return res.status(400).json({
                error: 'No approved images found for this job. Approve images in Gallery first.',
                jobId
            });
        }

        const results = [];
        let successCount = 0;
        let failCount = 0;

        for (const image of approvedImages) {
            // Idempotent: skip already processed
            if (image.status === 'PROCESSED' || image.status === 'COMPLETED') {
                results.push({ imageId: image.id, status: 'SKIPPED_ALREADY_PROCESSED' });
                continue;
            }

            try {
                // Enqueue to BullMQ instead of processing synchronously
                await assetQueue.add('processAsset', { imageId: image.id }, {
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 2000 }
                });
                successCount++;
                results.push({ imageId: image.id, status: 'ENQUEUED' });
            } catch (err) {
                failCount++;
                results.push({ imageId: image.id, status: 'FAILED_TO_ENQUEUE', error: err.message });
            }
        }

        res.json({
            jobId,
            message: `Pipeline completed: ${successCount} processed, ${failCount} failed, ${results.filter(r => r.status === 'SKIPPED_ALREADY_PROCESSED').length} skipped.`,
            results
        });
    } catch (err) {
        console.error('[Pipeline /run-job]', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/pipeline/status/:jobId — pipeline progress for a job
router.get('/status/:jobId', async (req, res) => {
    try {
        const images = await prisma.image.findMany({
            where: { jobId: req.params.jobId, job: { workspaceId: req.workspaceId }, OR: [{ isApproved: true }, { status: { in: ['PROCESSED', 'COMPLETED'] } }] },
            select: { id: true, status: true, masterFileUrl: true, isApproved: true }
        });
        res.json(images);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
