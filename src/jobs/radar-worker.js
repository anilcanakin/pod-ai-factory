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

const fetch       = require('node-fetch');
const { PrismaClient } = require('@prisma/client');
const { evaluateNiche } = require('../services/ai-brain.service');
const { getEtsyAutocomplete } = require('../services/keyword-research.service');
const { logNotification } = require('../routes/notification.routes');
const redis       = require('../config/redis');

const prisma = new PrismaClient();

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
    const results = await Promise.allSettled(
        seeds.slice(0, 8).map(seed => getEtsyAutocomplete(seed))
    );
    const niches = [];
    for (const r of results) {
        if (r.status === 'fulfilled') {
            for (const term of r.value) {
                niches.push({ niche: term, source: 'etsy' });
            }
        }
    }
    return niches;
}

async function fetchGoogleTrendingTopics() {
    try {
        const url = 'https://trends.google.com/trends/api/dailytrends?hl=en-US&tz=0&geo=US&ns=15';
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 12000,
        });
        if (!res.ok) return [];

        const text = await res.text();
        const clean = text.replace(/^[^{[]*/, '').trim();
        if (!clean) return [];

        const data = JSON.parse(clean);
        const searches = data?.default?.trendingSearchesDays?.[0]?.trendingSearches || [];

        return searches
            .map(t => t?.title?.query || '')
            .filter(q => q && /shirt|mug|gift|art|print|design|poster|sticker|apparel|tee|hoodie|case|tote|decor|pillow/i.test(q))
            .slice(0, 10)
            .map(niche => ({ niche, source: 'google_trends' }));
    } catch (err) {
        console.warn('[Radar] Google Trends fetch failed:', err.message);
        return [];
    }
}

async function fetchPinterestTrends(seeds) {
    const results = [];
    for (const seed of seeds.slice(0, 3)) {
        try {
            const encoded = encodeURIComponent(seed);
            const url = `https://www.pinterest.com/api/v3/search/typeahead/?query=${encoded}&scope=pins`;
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json',
                },
                timeout: 8000,
            });
            if (!res.ok) continue;
            const data = await res.json();
            const suggestions = (data?.suggestions || []).map(s => s?.term || '').filter(Boolean).slice(0, 4);
            for (const term of suggestions) {
                results.push({ niche: term, source: 'pinterest' });
            }
        } catch {
            // Pinterest may block — silently skip
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
    const [etsyNiches, googleNiches, pinterestNiches] = await Promise.all([
        fetchEtsyNiches(seeds),
        fetchGoogleTrendingTopics(),
        fetchPinterestTrends(getSeasonalSeeds()),
    ]);

    const allNiches = deduplicateNiches([...etsyNiches, ...googleNiches, ...pinterestNiches]).slice(0, 40);
    console.log(`[Radar] Toplam ${allNiches.length} aday niche: Etsy(${etsyNiches.length}) Google(${googleNiches.length}) Pinterest(${pinterestNiches.length})`);

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
