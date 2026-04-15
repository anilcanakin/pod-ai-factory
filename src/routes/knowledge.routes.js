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


module.exports = router;
