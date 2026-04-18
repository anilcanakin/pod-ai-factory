const express = require('express');
const router  = express.Router();
const wpi     = require('../services/wpi.service');
const { ApifyPaymentError, X402ConfigError } = require('../services/apify.service');

// ─── In-memory scan store ─────────────────────────────────────────────────────
// Her scan bir entry: { status, progress, result, error, startedAt }
// Single-server setup için yeterli; scale gerekirse Redis'e taşı.
const scans = new Map();

// 30 dakikadan eski tamamlanmış scan'leri temizle (memory leak önleme)
setInterval(() => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, s] of scans) {
        if (s.status !== 'running' && s.startedAt < cutoff) scans.delete(id);
    }
}, 5 * 60 * 1000);

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
 * → Timeout yok, proxy kesilmiyor.
 * → Durumu GET /api/wpi/scan/:scanId ile takip et.
 */
router.post('/scan', (req, res) => {
    const { keywords = [], saveWinners = true, maxPerKeyword } = req.body;

    if (!keywords.length) {
        return res.status(400).json({ error: 'keywords array is required (min 1 item)' });
    }

    const workspaceId = req.workspaceId || 'default-workspace';
    const scanId      = `wpi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Scan state'i başlat
    scans.set(scanId, {
        status:     'running',
        progress:   { total: keywords.length, done: 0, currentKeyword: keywords[0] },
        result:     null,
        error:      null,
        startedAt:  Date.now(),
    });

    // Hemen yanıt ver — bağlantı kapanmadan önce
    res.json({ success: true, scanId, status: 'running', total: keywords.length });

    // Arka planda çalıştır (response'u bekletmiyor)
    (async () => {
        const state = scans.get(scanId);
        try {
            // wpi.scan progress callback ile çağır
            const result = await wpi.scan(workspaceId, keywords, {
                saveWinners,
                maxPerKeyword,
                onKeywordStart: (kw, idx) => {
                    state.progress = { total: keywords.length, done: idx, currentKeyword: kw };
                },
                onKeywordDone: (kw, idx) => {
                    state.progress = { total: keywords.length, done: idx + 1, currentKeyword: kw };
                },
            });

            state.status = 'done';
            state.result = result;
        } catch (err) {
            state.status = 'error';
            state.error  = err.message;
            console.error(`[WPI] Scan ${scanId} failed:`, err.message);
        }
    })();
});

/**
 * GET /api/wpi/scan/:scanId
 * Poll endpoint — frontend her 3s'de bir çağırır.
 *
 * Yanıt:
 *   status: 'running' → { progress }
 *   status: 'done'    → { result }
 *   status: 'error'   → { error }
 */
router.get('/scan/:scanId', (req, res) => {
    const state = scans.get(req.params.scanId);
    if (!state) return res.status(404).json({ error: 'Scan bulunamadı veya süresi doldu.' });

    if (state.status === 'running') {
        return res.json({ success: true, status: 'running', progress: state.progress });
    }
    if (state.status === 'done') {
        return res.json({ success: true, status: 'done', result: state.result });
    }
    // error
    return res.json({ success: false, status: 'error', error: state.error });
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
