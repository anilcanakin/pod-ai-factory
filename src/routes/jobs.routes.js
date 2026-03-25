const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// GET /api/jobs — List all jobs for workspace
router.get('/', async (req, res) => {
    try {
        const workspaceId = req.workspaceId;
        if (!workspaceId) return res.status(401).json({ error: 'Authentication required.' });

        const jobs = await prisma.designJob.findMany({
            where: { workspaceId },
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: {
                images: {
                    take: 1,
                    where: {
                        NOT: { imageUrl: 'PENDING' }
                    },
                    orderBy: { createdAt: 'desc' }
                },
                _count: { select: { images: true } }
            }
        });

        res.json(jobs.map(job => ({
            id: job.id,
            status: job.status,
            createdAt: job.createdAt,
            imageCount: job._count.images,
            previewUrl: job.images[0]?.imageUrl || null
        })));

    } catch (err) {
        console.error('[Jobs List]', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
