/**
 * Autonomous Radar Worker
 *
 * Her 12 saatte bir:
 *   1. Etsy autocomplete'den trending aramaları toplar
 *   2. Google Trends Daily Topics'i çeker
 *   3. Pinterest keyword önerilerini tarar
 *   4. Her nişi ai-brain.service.js üzerinden "Discovery Score"'a göre değerlendirir
 *   5. Score >= 75 → CorporateMemory'e HOT_DISCOVERY olarak kaydeder
 *   6. Score >= 90 → CRITICAL HOT NOW bildirimi gönderir
 */

const { evaluateNiche } = require('../services/ai-brain.service');
const apifyService = require('../services/apify.service');
const { logNotification } = require('../routes/notification.routes');
const redis       = require('../config/redis');

const prisma = require('../lib/prisma');

// Eşik değerleri ai-brain.service.js/evaluateNiche içinde yönetiliyor (MIN_HOT_SCORE=75).
// Bildirim için isCritical bayrağı evaluateNiche tarafından score>=90 durumunda set edilir.
const CRITICAL_THRESHOLD = 90; // yalnızca loglama referansı için
const INTERVAL_MS         = 12 * 60 * 60 * 1000; // 12 saat
const INITIAL_DELAY_MS    = 5  * 60 * 1000;       // sunucu başlangıcından 5dk sonra

// ─── Seed Keywords ────────────────────────────────────────────────────────────

const BASE_SEEDS = [
    't-shirt', 'sweatshirt', 'hoodie', 'mug', 'sticker',
    'poster', 'phone case', 'tote bag', 'wall art', 'tumbler',
];

function getSeasonalSeeds() {
    const month = new Date().getMonth();
    const seasonal = {
        0:  ['new year', 'winter', 'january resolutions'],
        1:  ["valentine's day", 'love heart', 'romantic gift'],
        2:  ["st patrick's day", 'spring vibes', 'lucky charm'],
        3:  ['easter bunny', 'spring flowers', 'april'],
        4:  ["mother's day gift", 'mom appreciation', 'best mom'],
        5:  ["father's day gift", 'dad humor', 'graduation 2026'],
        6:  ['4th of july 250th', 'patriotic american', 'summer beach'],
        7:  ['back to school', 'summer vibes', 'teacher gift'],
        8:  ['fall aesthetic', 'autumn leaves', 'pumpkin spice'],
        9:  ['halloween gothic', 'spooky season', 'witch aesthetic'],
        10: ['thanksgiving', 'fall harvest', 'grateful'],
        11: ['christmas gift', 'holiday ornament', 'xmas ugly sweater'],
    };
    return seasonal[month] || [];
}

// ─── Data Sources ─────────────────────────────────────────────────────────────

async function fetchEtsyNiches(seeds) {
    try {
        const keywords = await apifyService.researchEtsyKeywords(seeds.slice(0, 6));
        return keywords
            .map(k => ({ niche: k.keyword, source: 'etsy' }))
            .filter(({ niche }) => niche && niche.length > 3);
    } catch (err) {
        console.warn('[Radar] Apify Etsy keyword fetch failed:', err.message);
        return [];
    }
}

async function fetchEventBasedNiches() {
    const month = new Date().getMonth();
    const events = {
        0:  ['new year resolution 2026 shirt', 'winter cozy aesthetic mug', 'january motivation poster'],
        1:  ["valentine's day personalized gift", 'love heart couples shirt', 'galentines day girl squad'],
        2:  ["st patrick's day lucky shirt", 'spring vibes aesthetic tee', 'march lucky charm mug'],
        3:  ['easter bunny spring shirt', 'spring flowers wall art', 'april earth day nature print'],
        4:  ["mother's day personalized gift", 'best mom wildflower wall art', 'mama bear cute shirt'],
        5:  ["father's day funny gift", 'dad joke shirt', 'graduation 2026 senior gift'],
        6:  ['4th july 250th anniversary patriotic', 'FIFA World Cup 2026 soccer fan', 'summer beach vibes'],
        7:  ['back to school teacher gift', 'summer end aesthetic', 'august reading bookish shirt'],
        8:  ['fall aesthetic pumpkin shirt', 'autumn leaves cozy mug', 'september harvest wall art'],
        9:  ['halloween gothic witch shirt', 'spooky season ghost mug', 'october skeleton aesthetic'],
        10: ['thanksgiving grateful family shirt', 'fall harvest pumpkin print', 'november cozy grateful'],
        11: ['christmas gift personalized ornament', 'holiday ugly sweater shirt', 'xmas family matching'],
    };
    return (events[month] || []).map(niche => ({ niche, source: 'event_calendar' }));
}

async function fetchPinterestNiches(seeds) {
    const results = [];
    for (const seed of seeds.slice(0, 2)) {
        try {
            const trends = await apifyService.scrapePinterestTrends(seed, 15);
            for (const pin of trends.slice(0, 5)) {
                const title = pin.title || '';
                if (title && title.length > 3) {
                    results.push({ niche: title.slice(0, 80), source: 'pinterest' });
                }
            }
        } catch (err) {
            console.warn(`[Radar] Apify Pinterest failed for "${seed}":`, err.message);
        }
    }
    return results;
}

// ─── Deduplication ────────────────────────────────────────────────────────────

function deduplicateNiches(allNiches) {
    const seen = new Set();
    return allNiches.filter(({ niche }) => {
        const key = niche.toLowerCase().trim();
        if (key.length < 4 || key.length > 80 || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// ─── Core Scan Logic ──────────────────────────────────────────────────────────

async function runRadarScan() {
    console.log('[Radar] 🚀 Autonomous scan başlatılıyor...');
    const scanStart = Date.now();

    let workspaces = [];
    try {
        workspaces = await prisma.workspace.findMany({ select: { id: true } });
    } catch (err) {
        console.error('[Radar] Workspace fetch failed:', err.message);
        return;
    }

    const seeds = [...BASE_SEEDS, ...getSeasonalSeeds()];

    // Tüm kaynaklardan topla
    const [etsyNiches, eventNiches, pinterestNiches] = await Promise.all([
        fetchEtsyNiches(seeds),
        fetchEventBasedNiches(),
        fetchPinterestNiches(getSeasonalSeeds()),
    ]);

    const allNiches = deduplicateNiches([...etsyNiches, ...eventNiches, ...pinterestNiches]).slice(0, 40);
    console.log(`[Radar] Toplam ${allNiches.length} aday niche: Etsy(${etsyNiches.length}) Events(${eventNiches.length}) Pinterest(${pinterestNiches.length})`);

    for (const ws of workspaces) {
        const workspaceId = ws.id;

        // Son 24h'te zaten kaydedilmiş nişleri atla
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const existing = await prisma.corporateMemory.findMany({
            where: { workspaceId, type: 'HOT_DISCOVERY', createdAt: { gte: cutoff } },
            select: { title: true },
        });
        const existingSet = new Set(existing.map(e => e.title.toLowerCase()));

        let hotCount = 0;
        let criticalCount = 0;

        for (const { niche, source } of allNiches) {
            const titleKey = `[radar] ${niche}`.toLowerCase();
            if (existingSet.has(titleKey)) continue;

            try {
                // evaluateNiche: scoreDiscovery + DB save (score >= 75) hepsini yapar
                const discovery = await evaluateNiche(workspaceId, niche, { source });

                if (discovery) {
                    existingSet.add(titleKey);
                    hotCount++;
                    console.log(`[Radar] HOT ✓  "${niche}" (${source}) → score:${discovery.discoveryScore}`);

                    if (discovery.isCritical) {
                        criticalCount++;
                        logNotification(
                            workspaceId,
                            'critical',
                            `🔥 CRITICAL HOT NOW: "${niche}" — Discovery Score: ${discovery.discoveryScore}/100`,
                            { score: discovery.discoveryScore, niche, source, type: 'HOT_DISCOVERY', isCritical: true }
                        );
                    }
                } else {
                    console.log(`[Radar] SKIP  "${niche}" (${source}) — eşik altı`);
                }

                // AI rate limit arasında 500ms bekle
                await new Promise(r => setTimeout(r, 500));
            } catch (err) {
                console.error(`[Radar] "${niche}" scoring error:`, err.message);
            }
        }

        const elapsed = ((Date.now() - scanStart) / 1000).toFixed(1);
        console.log(`[Radar] ✅ ${workspaceId}: ${hotCount} HOT keşif (${criticalCount} critical) | ${elapsed}s`);
    }

    // Son çalışma zamanını Redis'e yaz (UI için)
    redis.set('radar:lastRunAt', Date.now().toString()).catch(() => {});
}

// ─── Cron Starter ─────────────────────────────────────────────────────────────

function startCron() {
    const nextRunMin = Math.round(INITIAL_DELAY_MS / 60000);
    console.log(`[Radar] Cron başlatıldı — ilk tarama ~${nextRunMin} dk sonra, sonraki her 12 saatte bir.`);

    setTimeout(() => {
        runRadarScan().catch(err => console.error('[Radar] İlk tarama başarısız:', err.message));
        setInterval(
            () => runRadarScan().catch(err => console.error('[Radar] Cron tarama başarısız:', err.message)),
            INTERVAL_MS
        );
    }, INITIAL_DELAY_MS);
}

module.exports = { startCron, runRadarScan };
