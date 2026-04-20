const express = require('express');
const router  = express.Router();
const wpi     = require('../services/wpi.service');
const seoMotor = require('../services/seo.service');
const redis   = require('../config/redis');
const { ApifyPaymentError, X402ConfigError } = require('../services/apify.service');

// ─── Redis scan store ─────────────────────────────────────────────────────────
// In-memory Map yerine Redis: TTL sayesinde manuel temizlik yok,
// birden fazla sunucu instance'ı arasında paylaşılabilir.

const SCAN_TTL = 259_200;                          // 72 saat (saniye)
const scanKey  = id => `wpi:scan:${id}`;           // wpi:scan:<scanId>

async function _getScan(scanId) {
    const raw = await redis.get(scanKey(scanId));
    return raw ? JSON.parse(raw) : null;
}

// Tek bir key'i 72h TTL ile yazar.
async function _setScan(scanId, state) {
    await redis.set(scanKey(scanId), JSON.stringify(state), 'EX', SCAN_TTL);
}

// Pipeline: aynı roundtrip'te birden fazla Redis komutu gönderir.
// Kullanım: progress güncelleme + opsiyonel ek komutları atomik olarak yazmak.
async function _pipelineScan(scanId, state, extraCmds = []) {
    const pipe = redis.pipeline();
    pipe.set(scanKey(scanId), JSON.stringify(state), 'EX', SCAN_TTL);
    for (const [cmd, ...args] of extraCmds) {
        pipe[cmd](...args);
    }
    await pipe.exec();
}

// ─── Hata helper ─────────────────────────────────────────────────────────────

function handleError(err, res) {
    if (err instanceof X402ConfigError || err instanceof ApifyPaymentError) {
        console.warn('[WPI] Fallback devreye girdi:', err.message);
        return res.status(200).json({
            success: false,
            notice:  'Fallback Devreye Girdi',
            detail:  'Birincil scraper x402 ödeme gerektirdi — yedek aktöre geçildi.',
        });
    }
    console.error('[WPI route]', err.message);
    return res.status(500).json({ error: err.message });
}

/**
 * POST /api/wpi/scan
 * Body: { keywords: string[], saveWinners?: boolean, maxPerKeyword?: number }
 *
 * Scan'ı ARKA PLANDA başlatır, hemen scanId döner.
 */
router.post('/scan', async (req, res) => {
    const { keywords = [], saveWinners = true, maxPerKeyword } = req.body;

    if (!keywords.length) {
        return res.status(400).json({ error: 'keywords array is required (min 1 item)' });
    }

    const workspaceId = req.workspaceId || 'default-workspace';
    const scanId      = `wpi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const initKeywordStatuses = Object.fromEntries(keywords.map(kw => [kw, 'queued']));

    const initState = {
        status:    'running',
        progress:  {
            total: keywords.length, done: 0, currentKeyword: keywords[0],
            phase: 'scraping', aiDone: 0, aiTotal: 0,
            keywordStatuses: initKeywordStatuses,
        },
        result:    null,
        error:     null,
        startedAt: Date.now(),
    };

    // İlk yazma + opsiyonel metadata'yı pipeline ile birleştir
    await _pipelineScan(scanId, initState, [
        // wpi:active setine scanId ekle — izleme için (isteğe bağlı)
        ['sadd', 'wpi:active', scanId],
        ['expire', 'wpi:active', SCAN_TTL],
    ]);

    res.json({ success: true, scanId, status: 'running', total: keywords.length });

    // Arka planda çalıştır
    (async () => {
        try {
            const result = await wpi.scan(workspaceId, keywords, {
                saveWinners,
                maxPerKeyword,
                onKeywordStart: async (kw, idx) => {
                    const cur = await _getScan(scanId);
                    if (!cur) return;
                    cur.progress = {
                        ...cur.progress,
                        currentKeyword: kw, done: idx, phase: 'scraping', aiDone: 0, aiTotal: 0,
                        keywordStatuses: { ...cur.progress.keywordStatuses, [kw]: 'running' },
                    };
                    await _setScan(scanId, cur);
                },
                onKeywordDone: async (kw, idx, { timedOut = false } = {}) => {
                    const cur = await _getScan(scanId);
                    if (!cur) return;
                    cur.progress = {
                        ...cur.progress,
                        done: idx + 1, phase: 'done', aiDone: 0, aiTotal: 0,
                        keywordStatuses: { ...cur.progress.keywordStatuses, [kw]: timedOut ? 'timeout' : 'done' },
                    };
                    await _setScan(scanId, cur);
                },
                onProgress: async (kw, update) => {
                    const cur = await _getScan(scanId);
                    if (!cur) return;
                    cur.progress = {
                        ...cur.progress,
                        phase:   update.phase,
                        aiDone:  update.aiDone,
                        aiTotal: update.aiTotal,
                    };
                    await _setScan(scanId, cur);
                },
            });

            // Tamamlanma: sonucu + status'ü pipeline ile atomik yaz
            const doneState = { ...initState, status: 'done', result, progress: null };
            await _pipelineScan(scanId, doneState, [
                ['srem', 'wpi:active', scanId],
            ]);
        } catch (err) {
            const errState = { ...initState, status: 'error', error: err.message, progress: null };
            await _pipelineScan(scanId, errState, [
                ['srem', 'wpi:active', scanId],
            ]).catch(() => {}); // Redis'e yazma başarısız olsa da sürecin çökmesini engelle
            console.error(`[WPI] Scan ${scanId} failed:`, err.message);
        }
    })();
});

/**
 * GET /api/wpi/scan/:scanId
 * Poll endpoint — frontend her 3s'de bir çağırır.
 */
router.get('/scan/:scanId', async (req, res) => {
    try {
        const state = await _getScan(req.params.scanId);
        if (!state) return res.status(404).json({ error: 'Scan bulunamadı veya süresi doldu (72h).' });

        if (state.status === 'running') {
            return res.json({ success: true, status: 'running', progress: state.progress });
        }
        if (state.status === 'done') {
            return res.json({ success: true, status: 'done', result: state.result });
        }
        return res.json({ success: false, status: 'error', error: state.error });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/wpi/action-cards
 * Query: status=PENDING|APPROVED|REJECTED|ALL  (default: PENDING)
 *        limit=<number>                         (default: 20)
 */
router.get('/action-cards', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || 'default-workspace';
        const { status = 'PENDING', limit = 20 } = req.query;
        const cards = await wpi.listActionCards(workspaceId, {
            status: status.toUpperCase(),
            limit:  parseInt(limit, 10),
        });
        res.json({ success: true, count: cards.length, cards });
    } catch (err) {
        handleError(err, res);
    }
});

/**
 * POST /api/wpi/action-cards/:id/approve
 * Body: { sendToFactory?: boolean }
 */
router.post('/action-cards/:id/approve', async (req, res) => {
    try {
        const workspaceId     = req.workspaceId || 'default-workspace';
        const { sendToFactory = false } = req.body;
        const result = await wpi.approveActionCard(workspaceId, req.params.id, { sendToFactory });
        res.json({ success: true, ...result });
    } catch (err) {
        handleError(err, res);
    }
});

/**
 * POST /api/wpi/action-cards/:id/reject
 * Body: { reason?: string }
 */
router.post('/action-cards/:id/reject', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || 'default-workspace';
        const { reason = '' } = req.body;
        const result = await wpi.rejectActionCard(workspaceId, req.params.id, reason);
        res.json({ success: true, ...result });
    } catch (err) {
        handleError(err, res);
    }
});

/** GET /api/wpi/collections */
router.get('/collections', (req, res) => {
    res.json({ success: true, collections: wpi.COLLECTIONS_2026 });
});

/**
 * GET /api/wpi/factory-queue
 * WPI onaylı, Factory'de üretim bekleyen joblar.
 */
router.get('/factory-queue', async (req, res) => {
    try {
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        const workspaceId = req.workspaceId || 'default-workspace';

        const jobs = await prisma.designJob.findMany({
            where: { workspaceId, mode: 'wpi', status: 'PENDING' },
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: {
                id:            true,
                createdAt:     true,
                keyword:       true,
                niche:         true,
                style:         true,
                originalImage: true,
                status:        true,
            },
        });

        res.json({
            success: true,
            count: jobs.length,
            jobs: jobs.map(j => ({
                id:           j.id,
                createdAt:    j.createdAt,
                keyword:      j.keyword,
                niche:        j.niche,
                designPrompt: j.style?.split(' | ').slice(1).join(' | ') || j.style || '',
                colorPalette: j.style?.split(' | ')[0] || '',
                previewUrl:   j.originalImage || null,
            })),
        });
    } catch (err) {
        console.error('[WPI factory-queue]', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/wpi/action-cards/:id/seo-optimize
 * Action Card'dan Etsy SEO paketi üretir (title + 13 tags + description).
 */
router.post('/action-cards/:id/seo-optimize', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || 'default-workspace';
        const seoPackage  = await seoMotor.generateSeoPackage(req.params.id, workspaceId);
        res.json({ success: true, seoPackage });
    } catch (err) {
        console.error('[WPI seo-optimize]', err.message);
        res.status(500).json({ error: err.message });
    }
});

/** GET /api/wpi/config */
router.get('/config', (req, res) => {
    res.json({
        success: true,
        config: {
            brainConfidenceMin: wpi.BRAIN_CONFIDENCE_MIN,
            collectionsCount:   wpi.COLLECTIONS_2026.length,
            actor:              'shahidirfan/etsy-scraper (x402)',
        },
    });
});

module.exports = router;
