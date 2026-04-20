const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Queue, QueueEvents } = require('bullmq');
const redisConnection = require('../config/redis');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const knowledgeQueue = new Queue('knowledge-ingestion', { connection: redisConnection });

// ── Multer Yapılandırması ─────────────────────────────────────
const uploadDir = path.join(__dirname, '../../uploads/raw');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ 
    storage,
    limits: { fileSize: 1000 * 1024 * 1024 } // 1GB (Ağır PDF ve strateji videoları için)
});

/**
 * Dosya Yükleme ve İşleme Kuyruğuna Atma
 */
router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Dosya yüklenemedi.' });

        // İş kuyruğuna ekle (Asenkron)
        const job = await knowledgeQueue.add('process-file', {
            type: 'FILE',
            filePath: req.file.path,
            originalName: req.file.originalname,
            mimeType: req.file.mimetype,
            workspaceId: req.workspaceId
        }, {
            attempts: 5,
            backoff: { type: 'exponential', delay: 30000 } // 30 sn den başla
        });

        res.json({
            message: 'Dosya kuyruğa eklendi, işleniyor...',
            file: req.file.originalname,
            jobId: job.id          // ← Frontend polling için
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * YouTube Linki Kabul Etme
 */
router.post('/youtube', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'YouTube URL gerekli.' });

        await knowledgeQueue.add('process-youtube', {
            type: 'YOUTUBE',
            url: url,
            workspaceId: req.workspaceId
        }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 20000 }
        });

        res.json({ message: 'YouTube videosu kuyruğa eklendi.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * Bilgi Havuzu İstatistikleri
 */
router.get('/stats', async (req, res) => {
    try {
        // Raw SQL kullanarak pgvector tablosundaki satır sayısını alıyoruz
        const countResult = await prisma.$queryRaw`SELECT count(*)::int as count FROM etsy_knowledge`;
        res.json({ count: countResult[0].count });
    } catch (err) {
        res.json({ count: 0, warning: 'Table etsy_knowledge might not exist yet.' });
    }
});

/**
 * İş Durumu Sorgulama — Frontend polling için
 * GET /api/knowledge/status/:jobId
 */
router.get('/status/:jobId', async (req, res) => {
    try {
        const job = await knowledgeQueue.getJob(req.params.jobId);
        if (!job) return res.status(404).json({ error: 'İş bulunamadı.' });

        const state     = await job.getState();   // 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
        const progress  = job.progress || 0;
        const failedReason = job.failedReason || null;

        res.json({
            jobId:       job.id,
            state,
            progress,
            failedReason,
            isCompleted: state === 'completed',
            isFailed:    state === 'failed',
            isActive:    state === 'active',
            name:        job.data?.originalName || job.data?.url || ''
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


/**
 * POST /api/knowledge/ingest-text
 * Küçük metin / kural parçalarını doğrudan (kuyruğsuz) embedding ile kaydet.
 * Body: { title, content, category: 'STRATEGY'|'RULES'|'SEO_TACTICS' }
 */
router.post('/ingest-text', async (req, res) => {
    try {
        const { title = 'Manual Entry', content, category = 'STRATEGY' } = req.body;
        if (!content || !content.trim()) return res.status(400).json({ error: 'content alanı gerekli.' });

        const knowledgeService = require('../services/knowledge.service');
        const workspaceId = req.workspaceId || 'default-workspace';
        const saved = await knowledgeService.ingestText(workspaceId, title, content.trim(), category);

        res.json({ success: true, saved: saved.length, chunks: saved.map(r => r.id) });
    } catch (err) {
        console.error('[Knowledge /ingest-text]', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/knowledge/search
 * Semantic search — test & Brain "Knowledge Query" alanı için.
 * Body: { query, topK?, category? }
 */
router.post('/search', async (req, res) => {
    try {
        const { query, topK = 6, category } = req.body;
        if (!query) return res.status(400).json({ error: 'query alanı gerekli.' });

        const knowledgeService = require('../services/knowledge.service');
        const workspaceId = req.workspaceId || 'default-workspace';
        const results = await knowledgeService.searchSimilar(workspaceId, query, { topK, category });

        res.json({
            success: true,
            count:   results.length,
            results: results.map(r => ({
                id:       r.id,
                title:    r.title,
                content:  r.content.slice(0, 300),
                category: r.category,
                score:    Math.round(r.score * 100) / 100,
            })),
        });
    } catch (err) {
        console.error('[Knowledge /search]', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/knowledge/entries
 * Workspace'e ait tüm knowledge entries'leri listele.
 */
router.get('/entries', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || 'default-workspace';
        const { category, limit = 50 } = req.query;
        const where = { workspaceId, isActive: true };
        if (category) where.category = category;

        const entries = await prisma.corporateMemory.findMany({
            where,
            select: { id: true, title: true, content: true, category: true, type: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: parseInt(limit, 10),
        });

        res.json({ success: true, count: entries.length, entries });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/knowledge/entries/:id
 */
router.delete('/entries/:id', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || 'default-workspace';
        await prisma.corporateMemory.updateMany({
            where: { id: req.params.id, workspaceId },
            data:  { isActive: false },
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
