/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║        POD AI FACTORY — MARKET INTELLIGENCE SERVICE         ║
 * ║                   Apify Edition v2.0                        ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * 3 Paralel Ajan:
 *   1. getdataforme/etsy-product-search-scraper  →  Fiyat + Rekabet
 *   2. easyapi/etsy-keywords-research-tool        →  Etsy Trend Kelimeler
 *   3. easyapi/pinterest-search-scraper           →  Pinterest Estetik Trendler
 */

'use strict';

const { ApifyClient } = require('apify-client');

// ── Client ────────────────────────────────────────────────────────────
const apify = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

// ── Actor Kimlikleri ──────────────────────────────────────────────────
const ACTORS = {
    ETSY_PRODUCTS:  'getdataforme/etsy-product-search-scraper',
    ETSY_KEYWORDS:  'easyapi/etsy-keywords-research-tool',
    PINTEREST:      'easyapi/pinterest-search-scraper',
    ETSY_REVIEWS:   'vtr0n/etsy-reviews-scraper', // Rakip yorumları
};

const WAIT_SECS = 90;   // max bekleme — Apify ücretsiz tier için yeterli

// ═════════════════════════════════════════════════════════════════════
// AJAN 1 — Etsy Ürün Scraper (Fiyat + Rekabet)
// ═════════════════════════════════════════════════════════════════════
async function runProductScraper(keyword) {
    try {
        const run = await apify.actor(ACTORS.ETSY_PRODUCTS).call(
            { keywords: [keyword], maxItems: 20 },
            { waitSecs: WAIT_SECS }
        );
        const { items } = await apify.dataset(run.defaultDatasetId).listItems();
        if (!items?.length) return null;

        // Fiyat ayıkla
        const prices = items
            .map(item => {
                const raw = item.price ?? item.priceValue ?? item.listingPrice ?? item.originalPrice;
                if (typeof raw === 'number') return raw;
                if (typeof raw === 'string') {
                    const m = raw.match(/[\d.]+/);
                    return m ? parseFloat(m[0]) : null;
                }
                return null;
            })
            .filter(p => p != null && p > 0.5 && p < 2000);

        const avgPrice = prices.length
            ? +(prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2)
            : null;

        // Toplam sonuç sayısı
        const resultCount =
            items[0]?.totalCount ??
            items[0]?.searchResultsCount ??
            items[0]?.totalResults ??
            items.length;

        return { avgPrice, resultCount, sampleCount: items.length };

    } catch (err) {
        console.warn(`  [Ajan-1] ⚠️  Etsy Product hata: ${err.message}`);
        return null;
    }
}

// ═════════════════════════════════════════════════════════════════════
// AJAN 2 — Etsy Keyword Research (Trend Kelimeler)
// ═════════════════════════════════════════════════════════════════════
async function runKeywordResearch(keyword) {
    try {
        const run = await apify.actor(ACTORS.ETSY_KEYWORDS).call(
            { keyword },
            { waitSecs: WAIT_SECS }
        );
        const { items } = await apify.dataset(run.defaultDatasetId).listItems();
        if (!items?.length) return null;

        // Actor formatına göre farklı alanları dene
        const terms = items
            .flatMap(item =>
                item.keywords     ??
                item.suggestions  ??
                item.autocomplete ??
                item.relatedKeywords ??
                (item.keyword ? [item.keyword] : [])
            )
            .filter(k => typeof k === 'string' && k.trim().length > 0)
            .map(k => k.trim().toLowerCase())
            .filter((v, i, a) => a.indexOf(v) === i)  // dedupe
            .slice(0, 10);

        return { trendTerms: terms };

    } catch (err) {
        console.warn(`  [Ajan-2] ⚠️  Etsy Keywords hata: ${err.message}`);
        return null;
    }
}

// ═════════════════════════════════════════════════════════════════════
// AJAN 3 — Pinterest Trend Scraper (Estetik Vizyon)
// ═════════════════════════════════════════════════════════════════════
async function runPinterestScraper(keyword) {
    try {
        const run = await apify.actor(ACTORS.PINTEREST).call(
            { query: keyword, limit: 20 },
            { waitSecs: WAIT_SECS }
        );
        const { items } = await apify.dataset(run.defaultDatasetId).listItems();
        if (!items?.length) return null;

        // Pin başlıklarını estetik trend olarak kullan
        const pinterestTrends = items
            .map(item => item.title ?? item.description ?? item.alt ?? item.pinTitle)
            .filter(t => typeof t === 'string' && t.trim().length > 3)
            .map(t => t.trim().slice(0, 60))
            .slice(0, 8);

        return { pinterestTrends };

    } catch (err) {
        console.warn(`  [Ajan-3] ⚠️  Pinterest hata: ${err.message}`);
        return null;
    }
}

// ═════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════
function competitionLabel(count) {
    if (!count) return 'Bilinmiyor';
    if (count <  5_000)  return 'Düşük';
    if (count < 20_000)  return 'Orta';
    if (count < 80_000)  return 'Yüksek';
    return 'Çok Yüksek';
}

function estimateMonthlySales(resultCount, avgPrice) {
    if (!resultCount) return null;
    const base   = Math.max(1, Math.log10(resultCount));
    const volume = Math.round((500 / base) * (25 / Math.max(avgPrice ?? 25, 10)));
    return Math.min(volume, 2000);
}

function strategyHint(level) {
    return {
        'Düşük':     'Low competition — niche opportunity, go deep with long-tail phrases.',
        'Orta':      'Moderate competition — differentiate with style + gift occasion combos.',
        'Yüksek':    'High competition — prioritize gift occasion phrases and specific modifiers.',
        'Çok Yüksek':'Very high competition — ultra-specific long-tail only, avoid generic terms.',
    }[level] ?? 'Analyze and adapt strategy based on niche specifics.';
}

// ═════════════════════════════════════════════════════════════════════
// ANA FONKSİYON — getFullIntelligence
// ═════════════════════════════════════════════════════════════════════
/**
 * 3 Apify Actor'ü paralel çalıştırarak tam pazar istihbaratı toplar.
 *
 * @param {string} keyword
 * @returns {Promise<FullIntelligence>}
 */
async function getFullIntelligence(keyword) {
    if (!keyword?.trim()) return _fallback(keyword, 'Keyword boş');

    if (!process.env.APIFY_API_TOKEN || process.env.APIFY_API_TOKEN === 'your_apify_api_token_here') {
        console.warn('[İstihbarat] ⚠️  APIFY_API_TOKEN tanımlı değil — graceful fallback');
        return _fallback(keyword, 'APIFY_API_TOKEN eksik');
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  [İstihbarat] 🔭 3 ajan paralel başlatılıyor → "${keyword}"`);
    console.log(`${'═'.repeat(60)}`);

    const startMs = Date.now();

    // 3 ajanı tamamen paralel çalıştır
    const [productRes, keywordRes, pinterestRes] = await Promise.allSettled([
        runProductScraper(keyword),
        runKeywordResearch(keyword),
        runPinterestScraper(keyword),
    ]);

    const product   = productRes.status   === 'fulfilled' ? productRes.value   : null;
    const kwData    = keywordRes.status   === 'fulfilled' ? keywordRes.value   : null;
    const pinterest = pinterestRes.status === 'fulfilled' ? pinterestRes.value : null;

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

    // Veri birleştirme
    const resultCount      = product?.resultCount    ?? null;
    const averagePrice     = product?.avgPrice        ?? null;
    const competitionLevel = competitionLabel(resultCount);
    const estimatedMonthly = estimateMonthlySales(resultCount, averagePrice);
    const trendTerms       = kwData?.trendTerms       ?? [];
    const pinterestTrends  = pinterest?.pinterestTrends ?? [];

    // ── Süslü Terminal Logu ─────────────────────────────────────────
    console.log(`\n  ┌─────────────────────────────────────────────────┐`);
    console.log(`  │  📊  PAZAR İSTİHBARATI RAPORU                   │`);
    console.log(`  ├─────────────────────────────────────────────────┤`);
    console.log(`  │  🔑  Keyword       : "${keyword.slice(0, 35)}"`);
    console.log(`  │  🏷️  Ort. Fiyat    : ${averagePrice ? `$${averagePrice}` : 'Bilinmiyor'}`);
    console.log(`  │  ⚔️  Rekabet       : ${competitionLevel} (${resultCount?.toLocaleString() ?? '?'} listeleme)`);
    console.log(`  │  📦  Tahmini/Ay   : ${estimatedMonthly ? `~${estimatedMonthly} adet` : 'Bilinmiyor'}`);
    console.log(`  │  🔥  Trendler     : ${trendTerms.slice(0, 4).join(', ') || 'Bulunamadı'}`);
    console.log(`  │  📌  Pinterest    : ${pinterestTrends.slice(0, 2).map(s => `"${s.slice(0, 25)}"`).join(', ') || 'Bulunamadı'}`);
    console.log(`  │  ⏱️  Süre         : ${elapsed}s`);
    console.log(`  └─────────────────────────────────────────────────┘\n`);

    return {
        keyword,
        resultCount,
        averagePrice,
        competitionLevel,
        estimatedMonthly,
        trendTerms,
        pinterestTrends,
        strategy: strategyHint(competitionLevel),
        dataSource: 'apify',
        isFallback: false,
    };
}

// ═════════════════════════════════════════════════════════════════════
// PROMPT FORMATLAYICI
// ═════════════════════════════════════════════════════════════════════
/**
 * İstihbarat verisini Claude/GPT prompt'una hazır metin olarak formatlar.
 * @param {Object} intel - getFullIntelligence() çıktısı
 * @returns {string}
 */
function formatMarketContext(intel) {
    if (!intel || intel.isFallback) return '';

    const lines = [
        `═══ PAZAR GERÇEKLERİ (Market Intelligence) ═══`,
        `Keyword Analizi: "${intel.keyword}"`,
        `• Rekabet Seviyesi : ${intel.competitionLevel} (${intel.resultCount?.toLocaleString() ?? '?'} aktif listeleme)`,
        `• Ortalama Fiyat   : $${intel.averagePrice ?? '?'} USD`,
        `• Tahmini Aylık Sat: ~${intel.estimatedMonthly ?? '?'} adet (üst satıcılar)`,
    ];

    if (intel.trendTerms?.length) {
        lines.push(`• Etsy Trend Kelime: ${intel.trendTerms.slice(0, 8).join(', ')}`);
    }
    if (intel.pinterestTrends?.length) {
        lines.push(`• Pinterest Estetik : ${intel.pinterestTrends.slice(0, 4).join(' | ')}`);
    }

    lines.push(`• Strateji Önerisi : ${intel.strategy}`);
    lines.push(`═══════════════════════════════════════════════`);

    return lines.join('\n');
}

// ═════════════════════════════════════════════════════════════════════
// AJAN 4 — Etsy Review Scraper (Duygu Analizi)
// ═════════════════════════════════════════════════════════════════════
async function getReviewInsights(keyword) {
    try {
        console.log(`[Ajan-4] Rakip yorumları çekiliyor: ${keyword}`);
        const run = await apify.actor(ACTORS.ETSY_REVIEWS || 'vtr0n/etsy-reviews-scraper').call(
            { searchTerm: keyword, maxReviews: 50 },
            { waitSecs: WAIT_SECS }
        );
        const { items } = await apify.dataset(run.defaultDatasetId).listItems();
        
        // Yorumları analiz için temizle
        const reviewText = items.map(rev => rev.text).filter(t => t && t.length > 10).join(" | ");
        console.log(`[Ajan-4] ✅ Duygu analizi hazır (${items.length} yorum incelendi)`);
        return reviewText;

    } catch (err) {
        console.warn(`  [Ajan-4] ⚠️  Review Scraper hata: ${err.message}`);
        return null;
    }
}

// ═════════════════════════════════════════════════════════════════════
// FALLBACK
// ═════════════════════════════════════════════════════════════════════
function _fallback(keyword, reason = '') {
    return {
        keyword,
        resultCount:      null,
        averagePrice:     null,
        competitionLevel: 'Bilinmiyor',
        estimatedMonthly: null,
        trendTerms:       [],
        pinterestTrends:  [],
        strategy:         '',
        dataSource:       'fallback',
        isFallback:       true,
        fallbackReason:   reason,
    };
}

// Legacy alias — eski importları kırmamak için
const getMarketData = getFullIntelligence;

module.exports = { getFullIntelligence, getMarketData, formatMarketContext, getReviewInsights };
