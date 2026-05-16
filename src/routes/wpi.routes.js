const express = require('express');
const router  = express.Router();
const wpi     = require('../services/wpi.service');
const seoMotor = require('../services/seo.service');
const redis   = require('../config/redis');
const { ApifyPaymentError, X402ConfigError } = require('../services/apify.service');

// ─── Scan state store ────────────────────────────────────────────────────────
// Redis birincil depolama; Redis kota aşımı/hata durumunda in-memory Map devreye girer.

const SCAN_TTL  = 259_200;                         // 72 saat (saniye)
const scanKey   = id => `wpi:scan:${id}`;
const _memStore = new Map();                        // Redis fallback

async function _getScan(scanId) {
    try {
        const raw = await redis.get(scanKey(scanId));
        if (raw) return JSON.parse(raw);
    } catch (e) {
        console.warn(`[WPI] Redis GET hatası: ${e.message?.slice(0, 80)}`);
    }
    const mem = _memStore.get(scanId);
    console.log(`[WPI] _getScan ${scanId}: Redis yok, memStore=${mem ? 'BULUNDU' : 'YOK'} (toplam: ${_memStore.size})`);
    return mem ?? null;
}

async function _setScan(scanId, state) {
    let redisOk = false;
    try {
        const result = await redis.set(scanKey(scanId), JSON.stringify(state), 'EX', SCAN_TTL);
        redisOk = result === 'OK';
    } catch (e) {
        console.warn(`[WPI] Redis SET hatası → memStore kullanılıyor: ${e.message?.slice(0, 80)}`);
    }
    if (!redisOk) {
        _memStore.set(scanId, state);
        console.log(`[WPI] memStore kayıt: ${scanId}, mevcut kayıtlar: ${_memStore.size}`);
        setTimeout(() => _memStore.delete(scanId), 7_200_000);
    }
}

async function _pipelineScan(scanId, state, extraCmds = []) {
    // _setScan zaten kendi fallback'ini yönetiyor (throw → memStore)
    await _setScan(scanId, state);
    // extraCmds (sadd, srem, expire) — best-effort, hata görmezden gel
    if (extraCmds.length) {
        try {
            const pipe = redis.pipeline();
            for (const [cmd, ...args] of extraCmds) pipe[cmd](...args);
            await pipe.exec();
        } catch {}
    }
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
                const prisma = require('../lib/prisma');
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

/**
 * POST /api/wpi/rescan
 * Aynı keyword listesini yeniden tarar. Bir önceki snapshot varsa delta hesaplanır.
 * Body: { keywords: string[], saveWinners?: boolean }
 */
router.post('/rescan', async (req, res) => {
    const { keywords = [], saveWinners = true } = req.body;
    if (!keywords.length) {
        return res.status(400).json({ error: 'keywords array required' });
    }

    const workspaceId = req.workspaceId || 'default-workspace';
    const scanId      = `wpi_rescan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const kwStatuses  = Object.fromEntries(keywords.map(kw => [kw, 'queued']));

    const initState = {
        status: 'running', isRescan: true,
        progress: { total: keywords.length, done: 0, currentKeyword: keywords[0], phase: 'scraping', aiDone: 0, aiTotal: 0, keywordStatuses: kwStatuses },
        result: null, error: null, startedAt: Date.now(),
    };
    await _setScan(scanId, initState);
    res.json({ success: true, scanId, status: 'running', total: keywords.length, isRescan: true });

    (async () => {
        try {
            const result = await wpi.scan(workspaceId, keywords, {
                saveWinners,
                onKeywordStart: async (kw, idx) => {
                    const cur = await _getScan(scanId); if (!cur) return;
                    cur.progress = { ...cur.progress, currentKeyword: kw, done: idx, phase: 'scraping', aiDone: 0, aiTotal: 0, keywordStatuses: { ...cur.progress.keywordStatuses, [kw]: 'running' } };
                    await _setScan(scanId, cur);
                },
                onKeywordDone: async (kw, idx, { timedOut = false } = {}) => {
                    const cur = await _getScan(scanId); if (!cur) return;
                    cur.progress = { ...cur.progress, done: idx + 1, phase: 'done', keywordStatuses: { ...cur.progress.keywordStatuses, [kw]: timedOut ? 'timeout' : 'done' } };
                    await _setScan(scanId, cur);
                },
                onProgress: async (kw, update) => {
                    const cur = await _getScan(scanId); if (!cur) return;
                    cur.progress = { ...cur.progress, phase: update.phase, aiDone: update.aiDone, aiTotal: update.aiTotal };
                    await _setScan(scanId, cur);
                },
            });
            await _setScan(scanId, { ...initState, status: 'done', result, progress: null });
        } catch (err) {
            await _setScan(scanId, { ...initState, status: 'error', error: err.message, progress: null }).catch(() => {});
            console.error(`[WPI] Rescan ${scanId} failed:`, err.message);
        }
    })();
});

/**
 * GET /api/wpi/performance
 * WPI tahminleri vs gerçek satış — feedback loop özeti.
 */
router.get('/performance', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || 'default-workspace';
        const prisma = require('../lib/prisma');

        const [approvedCards, wpiJobs, incomeTransactions] = await Promise.all([
            prisma.corporateMemory.findMany({
                where: { workspaceId, type: 'WPI_WINNER' },
                orderBy: { createdAt: 'desc' },
                take: 50,
                select: { id: true, title: true, createdAt: true, analysisResult: true },
            }),
            prisma.designJob.findMany({
                where: { workspaceId, mode: 'wpi' },
                orderBy: { createdAt: 'desc' },
                take: 50,
                select: { id: true, keyword: true, niche: true, createdAt: true, status: true },
            }),
            prisma.financialTransaction.findMany({
                where: { workspaceId, type: 'INCOME' },
                orderBy: { createdAt: 'desc' },
                take: 100,
                select: { amount: true, description: true, createdAt: true },
            }),
        ]);

        const totalRevenue = incomeTransactions.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);

        const cards = approvedCards.map(c => ({
            id:         c.id,
            keyword:    c.analysisResult?.keyword,
            confidence: c.analysisResult?.brainComparison?.confidence ?? 0,
            actionType: c.analysisResult?.actionCard?.actionType,
            status:     c.analysisResult?.status ?? 'PENDING',
            approvedAt: c.analysisResult?.approvedAt ?? null,
            createdAt:  c.createdAt,
        }));

        const pendingCount  = cards.filter(c => c.status === 'PENDING').length;
        const approvedCount = cards.filter(c => c.status === 'APPROVED').length;
        const rejectedCount = cards.filter(c => c.status === 'REJECTED').length;
        const avgConfidence = cards.length
            ? Math.round(cards.reduce((s, c) => s + c.confidence, 0) / cards.length)
            : 0;

        res.json({
            success: true,
            summary: {
                totalCards:     cards.length,
                pending:        pendingCount,
                approved:       approvedCount,
                rejected:       rejectedCount,
                avgConfidence,
                totalWpiJobs:   wpiJobs.length,
                totalRevenue:   parseFloat(totalRevenue.toFixed(2)),
                revenueEntries: incomeTransactions.length,
            },
            cards:    cards.slice(0, 20),
            wpiJobs:  wpiJobs.slice(0, 10),
        });
    } catch (err) {
        console.error('[WPI performance]', err.message);
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

// ─── Autonomous Radar ─────────────────────────────────────────────────────────

const _prisma = require('../lib/prisma');

/**
 * GET /api/wpi/radar-discoveries
 * Query: hours=<number>  (default 24)
 *
 * Son N saatte otonom olarak keşfedilmiş HOT_DISCOVERY kayıtlarını döner.
 * Score'a göre azalan sırada sıralanır.
 */
router.get('/radar-discoveries', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || 'default-workspace';
        const hours       = Math.min(parseInt(req.query.hours || '24', 10), 168); // max 1 hafta
        const cutoff      = new Date(Date.now() - hours * 60 * 60 * 1000);

        // Tek kullanıcılı kurulum: tüm workspace'lerdeki HOT_DISCOVERY'leri göster.
        // Çok kiracılı geçişte buraya req.workspaceId filtresi eklenecek.
        const entries = await _prisma.corporateMemory.findMany({
            where:   { type: 'HOT_DISCOVERY', createdAt: { gte: cutoff } },
            orderBy: { createdAt: 'desc' },
            take:    200,
            select:  { id: true, workspaceId: true, title: true, content: true, createdAt: true, analysisResult: true },
        });
        console.log(`[Radar] ${entries.length} HOT_DISCOVERY (tüm workspaceler, son ${hours}h)`);

        // Son çalışma zamanını Redis'ten al (opsiyonel — worker'ın son çalışmasını izlemek için)
        let lastRunAt = null;
        let nextRunAt = null;
        try {
            const ts = await redis.get('radar:lastRunAt');
            if (ts) {
                lastRunAt = new Date(parseInt(ts, 10)).toISOString();
                nextRunAt = new Date(parseInt(ts, 10) + 7 * 24 * 60 * 60 * 1000).toISOString();
            }
        } catch { /* Redis yoksa sessizce geç */ }

        const discoveries = entries.map(e => ({
            id:                    e.id,
            niche:                 e.analysisResult?.niche || e.title.replace('[Radar] ', ''),
            discoveryScore:        e.analysisResult?.discoveryScore || 0,
            reasoning:             e.analysisResult?.reasoning || '',
            suggestedKeywords:     e.analysisResult?.suggestedKeywords || [],
            productRecommendation: e.analysisResult?.productRecommendation || '',
            urgency:               e.analysisResult?.urgency || 'medium',
            source:                e.analysisResult?.source || 'etsy',
            discoveredAt:          e.analysisResult?.discoveredAt || e.createdAt.toISOString(),
            isCritical:            e.analysisResult?.isCritical || false,
        })).sort((a, b) => b.discoveryScore - a.discoveryScore);

        res.json({ success: true, count: discoveries.length, discoveries, lastRunAt, nextRunAt });
    } catch (err) {
        console.error('[WPI radar-discoveries]', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/wpi/radar-trigger
 * Manuel olarak otonom radar taraması başlatır (arka planda çalışır).
 */
router.post('/radar-trigger', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || 'default-workspace';
        res.json({ success: true, message: 'Radar taraması başlatıldı — arka planda çalışıyor.' });

        // Arka planda çalıştır
        const { runRadarScan } = require('../jobs/radar-worker');
        runRadarScan().catch(err => console.error('[WPI radar-trigger] Scan failed:', err.message));

        // Son çalışma zamanını kaydet
        redis.set('radar:lastRunAt', Date.now().toString()).catch(() => {});
        console.log(`[WPI] radar-trigger: Manuel tarama başlatıldı — workspace: ${workspaceId}`);
    } catch (err) {
        console.error('[WPI radar-trigger]', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/wpi/radar-discoveries/:id/send-factory
 * HOT_DISCOVERY'yi Factory modülüne Draft Task olarak gönderir.
 * CorporateMemory'den niş bilgisini okur, DesignJob (mode='wpi') kaydı oluşturur.
 */
router.post('/radar-discoveries/:id/send-factory', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || 'default-workspace';

        const entry = await _prisma.corporateMemory.findFirst({
            where: { id: req.params.id, workspaceId, type: 'HOT_DISCOVERY' },
            select: { id: true, analysisResult: true },
        });

        if (!entry) {
            return res.status(404).json({ error: 'HOT_DISCOVERY bulunamadı' });
        }

        const ar = entry.analysisResult || {};
        const niche   = ar.niche   || '';
        const keyword = (ar.suggestedKeywords || [])[0] || niche;

        const job = await _prisma.designJob.create({
            data: {
                workspaceId,
                status:        'PENDING',
                mode:          'wpi',
                niche,
                keyword,
                style:         ar.productRecommendation || '',
                originalImage: '',
            },
        });

        console.log(`[WPI] Draft Task oluşturuldu — jobId: ${job.id} | niche: "${niche}"`);
        res.json({ success: true, jobId: job.id, niche, keyword });
    } catch (err) {
        console.error('[WPI radar send-factory]', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/wpi/niche-products?niche=...&maxResults=30
 * Bir niş için Etsy'deki gerçek ürünleri getirir.
 * reviewCount × 8 formülüyle haftalık ve aylık satış tahmini hesaplar.
 * Sonuçlar 24 saat Redis'te cache'lenir — Apify maliyetini düşürür.
 */
router.get('/niche-products', async (req, res) => {
    try {
        const { niche, maxResults = 30 } = req.query;
        if (!niche) return res.status(400).json({ error: 'niche parametresi zorunlu' });

        const cacheKey = `wpi:niche-products:${String(niche).toLowerCase().trim().slice(0, 80)}`;
        const CACHE_TTL = 86_400; // 24 saat (saniye)

        // Cache kontrolü
        const cached = await redis.get(cacheKey).catch(() => null);
        if (cached) {
            console.log(`[WPI niche-products] Cache HIT: "${niche}"`);
            return res.json({ ...JSON.parse(cached), fromCache: true });
        }

        // 4 dakikalık timeout — Apify çok uzun beklememeli
        const APIFY_TIMEOUT_MS = 4 * 60 * 1000;
        const apify    = require('../services/apify.service');
        const products = await Promise.race([
            apify.scrapeEtsyProducts(String(niche), parseInt(maxResults, 10)),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Apify zaman aşımı (4 dk) — daha sonra tekrar dene')), APIFY_TIMEOUT_MS)
            ),
        ]);

        const now = Date.now();
        const enriched = products.map(p => {
            const reviewCount  = p.reviewCount  || 0;
            const totalEst     = p.sales > 0 ? p.sales : reviewCount * 8;

            let listingAgeDays = null;
            if (p.listingDate) {
                const ts = typeof p.listingDate === 'number'
                    ? p.listingDate * 1000
                    : new Date(p.listingDate).getTime();
                if (!isNaN(ts)) listingAgeDays = Math.max(1, Math.floor((now - ts) / 86_400_000));
            }

            const monthlySales = listingAgeDays ? parseFloat((totalEst / (listingAgeDays / 30)).toFixed(1)) : null;
            const weeklySales  = listingAgeDays ? parseFloat((totalEst / (listingAgeDays / 7)).toFixed(1))  : null;

            return { ...p, totalEstimatedSales: totalEst, listingAgeDays, monthlySales, weeklySales };
        });

        enriched.sort((a, b) => (b.weeklySales ?? -1) - (a.weeklySales ?? -1));

        const payload = { success: true, count: enriched.length, niche, products: enriched };
        if (enriched.length > 0) {
            redis.set(cacheKey, JSON.stringify(payload), 'EX', CACHE_TTL).catch(() => {});
            console.log(`[WPI niche-products] Apify çağrıldı + cache yazıldı: "${niche}" (${enriched.length} ürün)`);
        } else {
            console.warn(`[WPI niche-products] 0 ürün döndü — cache'e yazılmadı: "${niche}"`);
        }

        res.json(payload);
    } catch (err) {
        console.error('[WPI niche-products]', err.message);
        if (err.message?.includes('memory limit') || err.message?.includes('exceed')) {
            return res.status(503).json({
                error: 'Apify bellek limiti doldu — aktif taramalar tamamlanınca tekrar dene (1-2 dk)',
                retryAfter: 120,
            });
        }
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
