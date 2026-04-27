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
        const saved = await knowledgeService.ingestText(workspaceId, title, content.trim(), category, { source: 'manual' });

        // Çelişki tespiti (ilk chunk'a göre)
        if (saved.length > 0) {
            try {
                await knowledgeService.detectAndResolveContradictions(
                    workspaceId, content.slice(0, 1000), category, saved[0].id
                );
            } catch (_) {}
        }

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
 * POST /api/knowledge/youtube-bulk
 * Body: { urls: Array<string | {url, title?, category?}> }
 */
router.post('/youtube-bulk', async (req, res) => {
    try {
        const { urls = [] } = req.body;
        if (!Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({ error: 'urls dizisi gerekli.' });
        }
        if (urls.length > 200) {
            return res.status(400).json({ error: 'Tek seferde en fazla 200 video gönderilebilir.' });
        }
        const workspaceId = req.workspaceId || 'default-workspace';
        const jobs = [];
        for (let i = 0; i < urls.length; i++) {
            const entry    = urls[i];
            const url      = typeof entry === 'string' ? entry : entry.url;
            const title    = (typeof entry === 'object' && entry.title)    || url;
            const category = (typeof entry === 'object' && entry.category) || 'STRATEGY';
            if (!url) continue;
            const job = await knowledgeQueue.add('process-youtube-smart', {
                type: 'YOUTUBE_SMART', url, originalName: title, category, workspaceId,
            }, { attempts: 3, backoff: { type: 'exponential', delay: 15000 } });
            jobs.push({ jobId: job.id, url, title, category });
            // Her 10 video'dan sonra 500ms bekle — Redis'i aşırı yüklememek için
            if ((i + 1) % 10 === 0 && i + 1 < urls.length) {
                await new Promise(r => setTimeout(r, 500));
            }
        }
        res.json({ success: true, jobs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/knowledge/ingest-jobs
 * Son 50 ingest job'unu state + progress ile döndür.
 */
router.get('/ingest-jobs', async (req, res) => {
    try {
        const [waiting, active, completed, failed] = await Promise.all([
            knowledgeQueue.getWaiting(0, 200),
            knowledgeQueue.getActive(0, 200),
            knowledgeQueue.getCompleted(0, 200),
            knowledgeQueue.getFailed(0, 200),
        ]);

        const all = [...active, ...waiting, ...completed, ...failed];
        const SOURCE_TYPES = new Set(['YOUTUBE_SMART', 'YOUTUBE', 'SOCIAL_MEDIA', 'RADAR_TREND', 'FILE']);
        const youtubeJobs = all.filter(j => SOURCE_TYPES.has(j.data?.type));

        const result = await Promise.all(youtubeJobs.map(async j => {
            const state = await j.getState();
            return {
                jobId:       j.id,
                state,
                progress:    j.progress || 0,
                url:         j.data?.url || '',
                title:       j.data?.originalName || j.data?.url || '',
                category:    j.data?.category || 'STRATEGY',
                failedReason: j.failedReason || null,
                timestamp:   j.timestamp,
                sourceType:  j.data?.type || 'YOUTUBE_SMART',
                platform:    j.data?.platform || null,
            };
        }));

        result.sort((a, b) => b.timestamp - a.timestamp);
        res.json({ success: true, jobs: result.slice(0, 200) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/knowledge/ingest
 * Unified ingest: youtube | social | radar sources.
 * Body: { source: 'youtube'|'social'|'radar', urls: string[], platform?: string, originalName?: string }
 */
router.post('/ingest', async (req, res) => {
    try {
        const { source, urls = [], platform, originalName } = req.body;
        if (!source) return res.status(400).json({ error: 'source alanı gerekli.' });
        if (!Array.isArray(urls) || urls.length === 0) return res.status(400).json({ error: 'urls dizisi gerekli.' });
        if (urls.length > 200) return res.status(400).json({ error: 'Tek seferde en fazla 200 URL gönderilebilir.' });

        const workspaceId = req.workspaceId || 'default-workspace';
        const jobs = [];

        for (let i = 0; i < urls.length; i++) {
            const entry = urls[i];
            const url   = typeof entry === 'string' ? entry : entry.url;
            const title = (typeof entry === 'object' && entry.title) || originalName || url;
            if (!url) continue;

            let jobType, jobName;
            if (source === 'youtube') {
                jobType = 'YOUTUBE_SMART'; jobName = 'process-youtube-smart';
            } else if (source === 'social') {
                jobType = 'SOCIAL_MEDIA';  jobName = 'process-social';
            } else if (source === 'radar') {
                jobType = 'RADAR_TREND';   jobName = 'process-radar';
            } else {
                return res.status(400).json({ error: `Bilinmeyen source: ${source}` });
            }

            const job = await knowledgeQueue.add(jobName, {
                type: jobType, url, originalName: title, category: 'STRATEGY', workspaceId, platform,
            }, { attempts: 3, backoff: { type: 'exponential', delay: 15000 } });
            jobs.push({ jobId: job.id, url, title, sourceType: jobType, platform });

            if ((i + 1) % 10 === 0 && i + 1 < urls.length) {
                await new Promise(r => setTimeout(r, 500));
            }
        }

        res.json({ success: true, jobs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/knowledge/queue-cleanup
 * Body: { jobIds?: string[], cleanFailed?: bool, cleanCompleted?: bool }
 *
 * jobIds → belirli job'ları sil (ör. 146-156 arası stuck job'lar)
 * cleanFailed=true → tüm failed job'ları temizle
 * cleanCompleted=true → tüm completed job'ları temizle
 * İkisi de verilmezse → sadece failed + completed temizle (güvenli varsayılan)
 */
router.post('/queue-cleanup', async (req, res) => {
    try {
        const { jobIds, cleanFailed = true, cleanCompleted = false } = req.body;
        const results = { removed: [], errors: [], failedCleaned: 0, completedCleaned: 0 };

        // Belirli job ID'lerini sil
        if (Array.isArray(jobIds) && jobIds.length > 0) {
            for (const id of jobIds) {
                try {
                    const job = await knowledgeQueue.getJob(String(id));
                    if (job) {
                        await job.remove();
                        results.removed.push(id);
                    } else {
                        results.errors.push({ id, error: 'Job bulunamadı' });
                    }
                } catch (e) {
                    results.errors.push({ id, error: e.message });
                }
            }
        }

        // Toplu temizlik
        if (cleanFailed) {
            const cleaned = await knowledgeQueue.clean(0, 500, 'failed');
            results.failedCleaned = cleaned.length;
        }
        if (cleanCompleted) {
            const cleaned = await knowledgeQueue.clean(0, 500, 'completed');
            results.completedCleaned = cleaned.length;
        }

        console.log(`[Queue] Temizlik: ${results.removed.length} spesifik, ${results.failedCleaned} failed, ${results.completedCleaned} completed kaldırıldı`);
        res.json({ success: true, ...results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/knowledge/channel-extract
 * Body: { url, maxResults? }
 * yt-dlp ile kanal/playlist video listesini çeker — Brain'e göndermeden sadece metadata döndürür.
 */
router.post('/channel-extract', async (req, res) => {
    try {
        const { url, maxResults = 200 } = req.body;
        if (!url) return res.status(400).json({ error: 'url alanı gerekli.' });

        const { extractChannelVideos } = require('../services/youtube.service');
        const result = await extractChannelVideos(url, parseInt(maxResults, 10));
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('[Knowledge /channel-extract]', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/knowledge/retry-failed
 * Failed YouTube job'larını Deep Scavenger modu ile yeniden kuyruğa alır.
 * Body: { jobIds?: string[], fromId?: number, toId?: number }
 *   - jobIds  → belirli job ID'lerini seç
 *   - fromId + toId → numericID aralığıyla seç (örn. 163–301)
 *   - İkisi de yok → tüm failed YouTube job'larını yeniden başlat
 */
router.post('/retry-failed', async (req, res) => {
    try {
        const { jobIds, fromId, toId } = req.body;
        const workspaceId = req.workspaceId || 'default-workspace';

        const failedJobs = await knowledgeQueue.getFailed(0, 1000);
        let toRetry = failedJobs.filter(j =>
            j.data?.type === 'YOUTUBE_SMART' || j.data?.type === 'YOUTUBE'
        );

        if (Array.isArray(jobIds) && jobIds.length > 0) {
            const idSet = new Set(jobIds.map(String));
            toRetry = toRetry.filter(j => idSet.has(String(j.id)));
        } else if (fromId !== undefined && toId !== undefined) {
            toRetry = toRetry.filter(j => {
                const n = parseInt(j.id, 10);
                return n >= fromId && n <= toId;
            });
        }

        if (toRetry.length === 0) {
            return res.json({ success: true, retried: 0, message: 'Tekrar başlatılacak job bulunamadı.' });
        }

        const retried = [];
        for (let i = 0; i < toRetry.length; i++) {
            const oldJob = toRetry[i];
            try {
                const newJob = await knowledgeQueue.add('process-youtube-smart', {
                    ...oldJob.data,
                    type:          'YOUTUBE_SMART',
                    deepScavenger: true,
                    retryOf:       oldJob.id,
                }, { attempts: 3, backoff: { type: 'exponential', delay: 15000 } });
                try { await oldJob.remove(); } catch (_) {}
                retried.push({ oldJobId: oldJob.id, newJobId: newJob.id, url: oldJob.data?.url });
            } catch (err) {
                console.warn(`[Retry] Job ${oldJob.id} yeniden başlatılamadı: ${err.message}`);
            }
            if ((i + 1) % 10 === 0 && i + 1 < toRetry.length) {
                await new Promise(r => setTimeout(r, 500));
            }
        }

        console.log(`[KnowledgeWorker] ${retried.length} failed job Deep Scavenger modu ile yeniden kuyruğa alındı`);
        res.json({ success: true, retried: retried.length, jobs: retried });
    } catch (err) {
        console.error('[Knowledge /retry-failed]', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/knowledge/queue-stats
 * Command Center için toplam/indexed/inQueue/failed istatistiklerini döndür.
 */
router.get('/queue-stats', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || 'default-workspace';
        const [counts, indexed] = await Promise.all([
            knowledgeQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
            prisma.corporateMemory.count({ where: { workspaceId, isActive: true } }),
        ]);
        const inQueue = (counts.waiting || 0) + (counts.active || 0) + (counts.delayed || 0);
        const total   = inQueue + (counts.completed || 0) + (counts.failed || 0);
        res.set('Cache-Control', 'no-store');
        res.json({
            total,
            indexed,
            inQueue,
            failed:    counts.failed    || 0,
            completed: counts.completed || 0,
            active:    counts.active    || 0,
            waiting:   counts.waiting   || 0,
        });
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
