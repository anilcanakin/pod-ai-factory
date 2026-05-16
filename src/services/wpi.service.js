/**
 * Winning Product Intelligence (WPI)
 *
 * Pipeline:
 *   scan(keywords) →
 *     scrapeEtsyProducts (Apify x402)        — live competitor data
 *     _detectTrending (snapshot comparison)  — 48h sales velocity
 *     _compareWithBrain (Claude Haiku)        — "can we do better?" (0-100%)
 *     _generateActionCard                    — Approve/Reject card if confidence ≥ 80
 *
 * Storage (CorporateMemory table):
 *   type: 'WPI_SNAPSHOT' — raw scan snapshot for trend diffing
 *   type: 'WPI_WINNER'   — pending action card awaiting approval
 */

const { scrapeEtsyProducts, ApifyPaymentError } = require('./apify.service');

const prisma = require('../lib/prisma');
const anthropic = require('../lib/anthropic');
const redis     = require('../config/redis');
const { getContextForAI } = require('./knowledge.service');
const { expandKeywords }  = require('./keyword-research.service');

// ─── Config ────────────────────────────────────────────────────────────────────
const MIN_SALES_FOR_WINNER    = 8;    // ignore products with < N sales
const TRENDING_DELTA_MIN      = 3;    // new sales in 24-48h to call "trending"
const BRAIN_CONFIDENCE_MIN    = 80;   // min % to generate an action card
const SNAPSHOT_LOOKBACK_HOURS = 72;   // compare against snapshots up to 3 days old
const MAX_PRODUCTS_PER_KW     = 50;   // products scraped per keyword
const MAX_WINNERS_PER_KW      = 5;    // cap action cards per keyword
const KEYWORD_CONCURRENCY     = 2;   // kaç keyword'ü paralel tarıyoruz
const AI_MIN_SALES             = 5;   // pre-filter: yalnızca bu satış üzerindeki ürünler AI'ya gider
const BRAIN_CACHE_TTL          = 3600; // 1h — aynı ürünü tekrar analiz ettirme
const AI_CHUNK_SIZE            = 5;   // paralel AI çağrısı sayısı (chunk başına)

// ─── 2026 Collection Matcher ───────────────────────────────────────────────────
const COLLECTIONS_2026 = [
    {
        name:     '250. Yıl Bağımsızlık Koleksiyonu',
        event:    '4th of July 2026 — 250th Anniversary',
        keywords: ['4th of july', '250th', 'american revolution', '1776', 'patriotic', 'independence', 'usa', 'liberty', 'freedom'],
    },
    {
        name:     'FIFA World Cup 2026 Koleksiyonu',
        event:    'FIFA World Cup 2026',
        keywords: ['world cup', 'fifa', 'soccer', 'football', 'futbol', 'goat', 'copa'],
    },
    {
        name:     'Anneler Günü Koleksiyonu',
        event:    "Mother's Day 2026 (May 10)",
        keywords: ['mother', 'mom', 'mama', 'anne', 'mothers day', 'floral mom', 'best mom'],
    },
    {
        name:     'Halloween 2026 Koleksiyonu',
        event:    'Halloween 2026',
        keywords: ['halloween', 'gothic', 'spooky', 'witch', 'skull', 'horror', 'ghost'],
    },
    {
        name:     'Noel 2026 Koleksiyonu',
        event:    'Christmas 2026',
        keywords: ['christmas', 'holiday', 'noel', 'xmas', 'winter', 'santa', 'ornament'],
    },
];

function _matchCollection(title = '', keyword = '') {
    const haystack = `${title} ${keyword}`.toLowerCase();
    for (const col of COLLECTIONS_2026) {
        if (col.keywords.some(kw => haystack.includes(kw))) return col;
    }
    return null;
}

// ─── eHunter-tarzı gelir/velocity metrikleri ─────────────────────────────────
// Etsy review rate ~2-3% → satış tahmini: reviews * 40
// Doğrudan satış verisi varsa onu kullan; yoksa review'dan tahmin et.

function _computeEhunterMetrics(product) {
    const sales = product.sales         || 0;
    const price = product.price         || 0;
    const revs  = product.reviewCount   || product.shopReviewCount || 0;
    const favs  = product.favoriteCount || 0;

    const effectiveSales          = sales > 0 ? sales : Math.round(revs * 40);
    const estimatedTotalRevenue   = Math.round(effectiveSales * price);
    const estimatedMonthlyRevenue = Math.round(estimatedTotalRevenue / 12);
    const velocityScore           = Math.round(sales * 2 + revs * 3 + favs * 0.5);

    return { estimatedTotalRevenue, estimatedMonthlyRevenue, velocityScore };
}

// ─── Snapshot helpers (stored in CorporateMemory) ─────────────────────────────

async function _saveSnapshot(workspaceId, keyword, products) {
    // Minimalist format — sadece trend hesaplaması için gereken alanlar.
    // { u: listingUrl, s: salesCount } — title/price/img burada saklanmaz,
    // Redis + Prisma payload'ını küçük tutar.
    const slim = products.map(p => ({
        u: p.listingUrl || p.url || '',
        s: p.sales ?? 0,
    }));

    await prisma.corporateMemory.create({
        data: {
            workspaceId,
            type:     'WPI_SNAPSHOT',
            title:    `[WPI_SNAPSHOT] ${keyword}`,
            content:  `${products.length} products @ ${new Date().toISOString()}`,
            category: 'STRATEGY',
            isActive: false,
            analysisResult: {
                scanType:  'WPI_SNAPSHOT',
                keyword,
                scannedAt: new Date().toISOString(),
                products:  slim,
            },
        },
    });
}

async function _loadPreviousSnapshot(workspaceId, keyword) {
    const cutoff = new Date(Date.now() - SNAPSHOT_LOOKBACK_HOURS * 3600 * 1000);
    const record = await prisma.corporateMemory.findFirst({
        where: {
            workspaceId,
            type:  'WPI_SNAPSHOT',
            title: `[WPI_SNAPSHOT] ${keyword}`,
            createdAt: { gte: cutoff },
        },
        orderBy: { createdAt: 'desc' },
    });
    return record?.analysisResult?.products ?? null;
}

// ─── Trending detection ────────────────────────────────────────────────────────

/**
 * Her ürüne trendScore ve isTrending/isBaseline flag'leri atar.
 *
 * Modlar:
 *   BASELINE (prevSnapshot yok):
 *     - İlk tarama → snapshot kaydet, Action Card üretme.
 *     - isTrending = false, isBaseline = true.
 *     - Tüm ürünler sadece snapshot olarak kaydedilir.
 *
 *   TRENDING (prevSnapshot var):
 *     - salesDelta = currentSales - prevSales  (shahidirfan: total_sales / sales_count)
 *     - salesDelta >= TRENDING_DELTA_MIN (3) → isTrending = true → Action Card adayı.
 *
 * Field normalize:
 *   Hem p.sales hem p.salesCount hem p.total_sales desteklenir
 *   (apify.service.js normalizer her ikisini de p.sales'a map eder,
 *    snapshot'ta ise "sales" key'i kullanılır — her ikisi de burada güvenli).
 */
function _detectTrending(products, prevSnapshot) {
    // prevSnapshot: [{ url, sales, ... }] veya null
    const prevMap = {};
    if (prevSnapshot) {
        for (const p of prevSnapshot) {
            // Yeni format: { u, s } — eski format: { url/listingUrl, sales } (geriye uyumlu)
            const key = p.u || p.url || p.listingUrl || '';
            if (key) prevMap[key] = p.s ?? p.sales ?? 0;
        }
    }
    const hasHistory = prevSnapshot !== null && Object.keys(prevMap).length > 0;

    return products.map(p => {
        const currentSales = p.sales || 0;
        const productKey   = p.listingUrl || p.url || '';

        let salesDelta  = 0;
        let isTrending  = false;
        let isBaseline  = !hasHistory;

        if (hasHistory) {
            if (prevMap[productKey] !== undefined) {
                salesDelta = Math.max(0, currentSales - prevMap[productKey]);
                isTrending = salesDelta >= TRENDING_DELTA_MIN;
            }
        }

        // HOT NOW: Güçlü sinyal varsa salesDelta beklenmez, anında ACTION CARD
        const isHotNow = !!(p.isBestSeller || (p.inCartCount > INSTANT_IN_CART_MIN) || p.isPopularNow);
        if (isHotNow) isTrending = true;

        const trendPeriod = isHotNow
            ? 'HOT_NOW'
            : hasHistory ? '48h' : 'BASELINE';

        const trendScore = hasHistory
            ? salesDelta * 10 + currentSales * 0.1   // delta ağırlıklı
            : isHotNow
                ? currentSales * 2                     // HOT NOW boost
                : currentSales;

        return {
            ...p,
            trendData: {
                salesCount:  currentSales,
                salesDelta,
                trendPeriod,
                isTrending,
                isBaseline:  !hasHistory && !isHotNow,
                isHotNow,
                trendScore,
            },
        };
    });
}

// ─── Product Categorizer ──────────────────────────────────────────────────────

const INSTANT_IN_CART_MIN = 20; // minimum in_cart sayısı

const _APPAREL_RE   = /shirt|tee|hoodie|sweatshirt|apparel|clothing|tank|jacket|dress|shorts|legging|onesie/i;
const _DECOR_RE     = /wall art|poster|print|home decor|pillow|blanket|mug|cup|canvas|frame|tapestry|sign|banner/i;
const _ACCESSORY_RE = /bag|tote|hat|cap|phone case|accessory|accessories|keychain|mask|patch|pin/i;
const _NONPOD_RE    = /jewelry|jewellery|ring|necklace|bracelet|earring|bead|gemstone|crystal|supply|supplies|material|yarn|fabric|tool/i;

function _categorizeProduct(product) {
    const isDigital = !!(product.isDigital ?? product.is_digital);
    if (isDigital) return 'DIGITAL_DOWNLOAD';

    const haystack = [
        product.taxonomyPath  ?? product.taxonomy_path ?? '',
        product.category      ?? '',
        product.title         ?? '',
    ].join(' ');

    if (_NONPOD_RE.test(haystack))    return 'NON_POD';
    if (_APPAREL_RE.test(haystack))   return 'POD_APPAREL';
    if (_DECOR_RE.test(haystack))     return 'HOME_DECOR';
    if (_ACCESSORY_RE.test(haystack)) return 'ACCESSORIES';

    return 'POD_APPAREL'; // safe default — most POD is apparel
}

// ─── Brain cache (Redis, 1 saat TTL) ─────────────────────────────────────────

function _brainCacheKey(url, keyword) {
    return 'wpi:brain:' + Buffer.from(`${url}|${keyword}`).toString('base64').slice(0, 48);
}

async function _getCachedBrain(url, keyword) {
    if (!url) return null;
    try {
        const raw = await redis.get(_brainCacheKey(url, keyword));
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

async function _setCachedBrain(url, keyword, result) {
    if (!url) return;
    try {
        await redis.set(_brainCacheKey(url, keyword), JSON.stringify(result), 'EX', BRAIN_CACHE_TTL);
    } catch {}
}

// ─── Parallel chunk processor ─────────────────────────────────────────────────

async function _processChunks(items, chunkSize, asyncFn) {
    const results = [];
    for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(chunk.map(asyncFn));
        results.push(...chunkResults);
    }
    return results;
}

// ─── Instant Intelligence ─────────────────────────────────────────────────────

/**
 * BASELINE aşamasında bile çalışır.
 * Güçlü sinyali olan ürünleri tespit eder:
 *   - is_best_seller === true
 *   - in_cart > INSTANT_IN_CART_MIN
 *   - is_popular_now === true
 * Bunlar "IMMEDIATE ACTION" olarak işaretlenir — satış delta beklenmez.
 */
function _detectInstantWinners(products) {
    return products.filter(p => {
        const signals = [];
        if (p.isBestSeller)                        signals.push('BEST_SELLER');
        if (p.inCartCount > INSTANT_IN_CART_MIN)   signals.push(`IN_CART_${p.inCartCount}`);
        if (p.isPopularNow)                        signals.push('POPULAR_NOW');
        if (signals.length === 0) return false;

        // Sinyal listesini ürüne ekle — sonraki adımlarda kullanılır
        p._instantSignals = signals;
        return true;
    });
}

/**
 * Instant winner için özel Brain prompt:
 * "Bu ürün zaten Best Seller — biz buna nasıl bir Competitive Edge ekleyebiliriz?"
 */
async function _compareWithBrainInstant(product, keyword, workspaceId, { marketContext = null, scoutContext = null, autocompleteHints = null } = {}) {
    const [memories, seoKb, academyContext] = await Promise.all([
        prisma.corporateMemory.findMany({
            where: {
                workspaceId,
                isActive: true,
                type:     { not: 'WPI_SNAPSHOT' },
                category: { in: ['VISUAL', 'STRATEGY', 'SEO'] },
            },
            orderBy: { createdAt: 'desc' },
            take:    12,
        }),
        prisma.seoKnowledgeBase.findFirst({
            where: { workspaceId, isActive: true },
            orderBy: { createdAt: 'desc' },
        }),
        getContextForAI(workspaceId, `${product.title} ${keyword}`, { maxChars: 600, topK: 4 }),
    ]);

    const brainLines = memories.length > 0
        ? memories.map(m => `[${m.category}] ${m.title.slice(0, 60)}: ${m.content.slice(0, 180)}`).join('\n')
        : '(Knowledge base boş — genel Etsy POD bilgisiyle değerlendir.)';

    const seoLines = seoKb?.content ? seoKb.content.slice(0, 400) : '(SEO KB boş)';
    const academyLines = academyContext || '(Academy henüz boş)';

    const signalLines = (product._instantSignals || []).map(s => {
        if (s === 'BEST_SELLER')       return '✅ Etsy Best Seller rozetine sahip';
        if (s.startsWith('IN_CART_'))  return `✅ Şu an ${s.replace('IN_CART_', '')} sepette — yoğun talep var`;
        if (s === 'POPULAR_NOW')       return '✅ "Popular Right Now" etiketiyle öne çıkarılıyor';
        return s;
    }).join('\n');

    const marketBlock = marketContext
        ? `\nMARKET BAĞLAMI:
- Top 5 rakip ortalama yorum: ${marketContext.avgTopReviews}
- Nişte ortalama fiyat: $${marketContext.avgPrice}
- Rekabet seviyesi: ${marketContext.competitionLevel}
- Rakipler yenilebilir mi: ${marketContext.isBeatable ? 'Evet' : 'Zor'}`
        : '';

    const scoutBlock  = scoutContext    ? `\nTREND NİŞLER (Scout):\n${scoutContext}`                : '';
    const acBlock     = autocompleteHints ? `\nETSY ARAMA: ${autocompleteHints}`                     : '';

    const prompt = `Sen deneyimli bir Etsy POD stratejisti ve yaratıcı direktörsün.

RAKİP ÜRÜN — ANLIK WINNER:
- Başlık: "${product.title}"
- Fiyat: $${product.price}
- Toplam Satış: ${product.sales || 0} adet
- Mağaza: ${product.shopName}
- Niche Keyword: "${keyword}"
${marketBlock}${scoutBlock}${acBlock}

GÜÇLÜ SİNYALLER:
${signalLines}

BİZİM KNOWLEDGE BASE:
${brainLines}

SEO BİLGİSİ:
${seoLines}

ACADEMY KURALLARI (Strateji / Kurallar / SEO Taktikleri — BUNLARA AYKIRI HİÇBİR ŞEY ÖNERME):
${academyLines}

GÖREV: Bu ürün ZATEN bir Best Seller / yüksek talep gören ürün.
Soru: **Biz buna nasıl bir "Competitive Edge" (Rekabetçi Avantaj) ekleyebiliriz?**

Değerlendirme kriterleri:
- Tasarım kalitesi açığı (aynı konuyu daha iyi görselle yapabilir miyiz?)
- Fiyat/değer pozisyonlaması (premium veya budget segment boş mu?)
- Niş alt-kategori fırsatı (rakip geniş hedef kitleye mi gidiyor, biz spesifik olabilir miyiz?)
- 2026 mevsimsel açı (4th of July 250th, World Cup, Mother's Day vb. ile bağlantı kurulabilir mi?)
- Koleksiyon uyumu (brain'deki mevcut koleksiyonlara eklenebilir mi?)

SADECE JSON döndür:
{
  "confidence": <0-100, bu nichede rakibe karşı başarı ihtimalimiz>,
  "reasoning": "<Türkçe, max 2 cümle, neden bu rakip strong ve biz nasıl farklılaşırız>",
  "competitiveEdge": "<Türkçe — 'Rakip şunu yapmış: [X]. Biz [Y] eklersek daha iyi satarız çünkü [Z].' formatında, 2 cümle max>",
  "designSuggestion": "<Türkçe, 1 net cümle — rakibe göre ne yapmalıyız?>",
  "designPrompt": "<İngilizce, Fal.ai için optimize edilmiş prompt — stil, renkler, teknik detaylar dahil. Ör: 'best seller patriotic t-shirt design, bold eagle graphic, distressed vintage style, navy blue + red + white, transparent background, high contrast, DTG print ready'>",
  "niche": "<tek kelime>",
  "targetKeywords": ["<en iyi 3 Etsy keyword>"],
  "colorPalette": "<önerilen renk paleti, ör: navy blue + gold + cream>",
  "differentiationAngle": "<rakipten fark yaratan en kritik özellik — ör: 'ultra-minimal tipografi', '250th anniversary spesifik', 'personalize edilebilir'>"
}`;

    try {
        const res = await anthropic.messages.create({
            model:      'claude-haiku-4-5-20251001',
            max_tokens: 700,
            messages:   [{ role: 'user', content: prompt }],
        });

        const raw   = res.content[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('No JSON in response');
        return JSON.parse(match[0]);
    } catch (err) {
        console.warn(`[WPI-Instant] Brain comparison failed for "${product.title}": ${err.message}`);
        return {
            confidence:           0,
            reasoning:            'Analiz tamamlanamadı.',
            competitiveEdge:      '',
            designSuggestion:     '',
            niche:                keyword,
            targetKeywords:       [],
            colorPalette:         '',
            differentiationAngle: '',
        };
    }
}

// ─── Market Context Analyzer ──────────────────────────────────────────────────

/**
 * Ürün listesinden rakip yoğunluğu ve fiyat tabanı hesaplar.
 * competitionLevel: LOW (<150) | MEDIUM (150-499) | HIGH (500-999) | VERY_HIGH (1000+)
 * priceFloor: true → avg fiyat $20 altında (POD marjı sıkışık)
 * isBeatable: true → solo satıcı girebilir (top5 avg review < 400)
 */
function _analyzeMarketContext(products) {
    if (!products.length) {
        return { avgTopReviews: 0, avgPrice: 0, isBeatable: true, competitionLevel: 'LOW', priceFloor: false };
    }

    // Listing-level reviews (shahidirfan) → competition proxy.
    // shop_total_rating_count (getdataforme) is shop-wide, NOT listing-level — kept in shopReviewCount.
    // If all listing reviewCounts are 0, the niche is data-limited (not necessarily unbeatable).
    const sorted = [...products].sort((a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0));
    const top5   = sorted.slice(0, 5);

    const avgTopReviews = top5.length
        ? Math.round(top5.reduce((s, p) => s + (p.reviewCount ?? 0), 0) / top5.length)
        : 0;

    // Outlier temizle: $150 üzeri POD için anlamsız (özel sipariş vs)
    const rawPrices = products.map(p => p.price);
    console.log(`[WPI] Raw prices from scraper:`, rawPrices.slice(0, 8));
    // Cents detection: shahidirfan bazı fiyatları cents cinsinden döndürebilir (2799 = $27.99)
    const likelyInCents = rawPrices.filter(p => p > 0).every(p => p > 200);
    const normalizedPrices = likelyInCents ? rawPrices.map(p => p / 100) : rawPrices;
    if (likelyInCents) console.log(`[WPI] Fiyatlar cents formatında görünüyor → /100 normalizasyon uygulandı`);
    const prices   = normalizedPrices.filter(p => p > 0 && p < 150);
    const avgPrice = prices.length
        ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length * 100) / 100
        : 0;

    const isBeatable       = avgTopReviews < 400;
    const competitionLevel = avgTopReviews >= 1000 ? 'VERY_HIGH'
                           : avgTopReviews >= 500  ? 'HIGH'
                           : avgTopReviews >= 150  ? 'MEDIUM'
                           : 'LOW';
    const priceFloor = avgPrice > 0 && avgPrice < 20;

    return { avgTopReviews, avgPrice, isBeatable, competitionLevel, priceFloor };
}

// ─── Scout Context Loader ─────────────────────────────────────────────────────

async function _getScoutContext(workspaceId) {
    try {
        const records = await prisma.corporateMemory.findMany({
            where:   { workspaceId, type: 'WPI_SCOUT', isActive: true },
            orderBy: { createdAt: 'desc' },
            take:    6,
        });
        if (!records.length) return null;
        return records
            .map(r => `• ${r.analysisResult?.niche ?? r.title}: ${(r.analysisResult?.reasoning ?? '').slice(0, 120)}`)
            .join('\n');
    } catch { return null; }
}

// ─── Brain comparison ──────────────────────────────────────────────────────────

/**
 * Asks Claude Haiku whether we can build a better product than the competitor.
 * Injects relevant CorporateMemory + SEO knowledge as context.
 * Returns { confidence, reasoning, designSuggestion, niche, targetKeywords,
 *           colorPalette, competitiveEdge }
 */
async function _compareWithBrain(product, keyword, workspaceId, { marketContext = null, scoutContext = null, autocompleteHints = null } = {}) {
    // Fetch relevant brain memories (VISUAL + STRATEGY + SEO categories)
    const [memories, seoKb, academyContext] = await Promise.all([
        prisma.corporateMemory.findMany({
            where: {
                workspaceId,
                isActive: true,
                type:     { not: 'WPI_SNAPSHOT' },
                category: { in: ['VISUAL', 'STRATEGY', 'SEO'] },
            },
            orderBy: { createdAt: 'desc' },
            take:    12,
        }),
        prisma.seoKnowledgeBase.findFirst({
            where: { workspaceId, isActive: true },
            orderBy: { createdAt: 'desc' },
        }),
        getContextForAI(workspaceId, `${product.title} ${keyword}`, { maxChars: 600, topK: 4 }),
    ]);

    const brainLines = memories.length > 0
        ? memories.map(m => `[${m.category}] ${m.title.slice(0, 60)}: ${m.content.slice(0, 180)}`).join('\n')
        : '(Henüz knowledge base girişi yok — genel Etsy POD bilgisiyle değerlendir.)';

    const seoLines = seoKb?.content
        ? seoKb.content.slice(0, 400)
        : '(SEO KB boş)';

    const academyLines = academyContext || '(Academy henüz boş)';

    const marketBlock = marketContext
        ? `\nMARKET BAĞLAMI (rakip yoğunluğu):
- Top 5 rakip ortalama yorum: ${marketContext.avgTopReviews}
- Nişte ortalama fiyat: $${marketContext.avgPrice}
- Rekabet seviyesi: ${marketContext.competitionLevel}${marketContext.priceFloor ? '\n- ⚠️ Ortalama fiyat $20 altında — POD marjı sıkışık' : ''}
- Rakipler yenilebilir mi: ${marketContext.isBeatable ? 'Evet (solo satıcı girebilir)' : 'Zor (çok olgun pazar)'}`
        : '';

    const scoutBlock = scoutContext
        ? `\nGÜNCEL TREND NİŞLER (Scout verisi):\n${scoutContext}`
        : '';

    const autocompleteBlock = autocompleteHints
        ? `\nETSY ARAMA ÖNERİLERİ (talep sinyali): ${autocompleteHints}`
        : '';

    const shopReviewLine = (product.shopReviewCount ?? 0) > 0
        ? `- Mağaza Toplam Yorumu: ${product.shopReviewCount} (niş aktifliğini gösterir)`
        : '';

    const prompt = `Sen deneyimli bir Etsy POD stratejisti ve tasarımcısısın.

RAKİP ÜRÜN ANALİZİ:
- Başlık: "${product.title}"
- Fiyat: $${product.price}
- Toplam Satış: ${product.trendData.salesCount} adet
- Ürün Yorumu: ${product.reviewCount || 0} (listing bazlı)
${shopReviewLine}- Son 48 saatte yeni satış: ${product.trendData.salesDelta > 0 ? product.trendData.salesDelta + ' adet' : 'Veri yok (ilk tarama)'}
- Niche Keyword: "${keyword}"
- Mağaza: ${product.shopName}
${marketBlock}${scoutBlock}${autocompleteBlock}

bizim KNOWLEDGE BASE:
${brainLines}

SEO BİLGİSİ:
${seoLines}

ACADEMY KURALLARI (Strateji / Kurallar / SEO Taktikleri — BUNLARA AYKIRI HİÇBİR ŞEY ÖNERME):
${academyLines}

NOT: Ürün yorumu 0 ise bu, scraper'ın listing bazlı veri döndürmediği anlamına gelir — mağaza toplam yorumu nişin canlılığını gösterir. Tasarım fırsatına odaklan.

SORU: BİZ bu nişte daha iyi/farklı bir ürün yapabilir miyiz?

Değerlendirme kriterleri (ağırlık sırası):
1. Tasarım kalitesi fırsatı — rakip başlığına göre tasarım sıradan mı / biz farklılaşabilir miyiz?
2. Fiyat konumlandırma — $18-28 hedef bandında yer var mı?
3. KB'deki trend/stil bilgisiyle örtüşme
4. Mevsimsel fırsat (Mayıs 2026: 4th of July yaklaşıyor, World Cup 2026 başlıyor, yaz sezonu)
Confidence ≥ 50 ise "girmeye değer fırsat" sayılır. Tasarımın kötü olduğu ama nişin canlı olduğu durumlarda 50-65 arası ver.

SADECE JSON döndür:
{
  "confidence": <0-100>,
  "reasoning": "<Türkçe, max 2 cümle, neden bu skoru verdik>",
  "designSuggestion": "<Türkçe, 1 net cümle, ne yapmalıyız?>",
  "designPrompt": "<İngilizce, Fal.ai için optimize edilmiş prompt — stil, renkler, teknik detaylar dahil, ör: 'minimalist patriotic poster, bold typography, navy blue + gold, clean white background, high contrast, printable wall art quality'>",
  "competitiveEdge": "<Türkçe — 'Rakip şunu yapmış: [X]. Biz [Y] eklersek daha iyi satarız çünkü [Z].' formatında, 2 cümle max>",
  "niche": "<tek kelime>",
  "targetKeywords": ["<en iyi 3 Etsy keyword>"],
  "colorPalette": "<önerilen renk paleti, ör: navy blue + gold + cream>"
}`;

    try {
        const res = await anthropic.messages.create({
            model:      'claude-haiku-4-5-20251001',
            max_tokens: 600,
            messages:   [{ role: 'user', content: prompt }],
        });

        const raw = res.content[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('No JSON in response');
        return JSON.parse(match[0]);
    } catch (err) {
        console.warn(`[WPI] Brain comparison failed for "${product.title}": ${err.message}`);
        return {
            confidence:       0,
            reasoning:        'Analiz tamamlanamadı.',
            designSuggestion: '',
            niche:            keyword,
            targetKeywords:   [],
            colorPalette:     '',
            competitiveEdge:  '',
        };
    }
}

// ─── Action Card builder ───────────────────────────────────────────────────────

function _buildActionCard(product, keyword, brainResult, { isInstant = false } = {}) {
    const collection = _matchCollection(product.title, keyword);
    const td         = product.trendData;

    let salesLine;
    if (isInstant) {
        const signals = (product._instantSignals || []).map(s => {
            if (s === 'BEST_SELLER')        return 'Best Seller rozeti';
            if (s.startsWith('IN_CART_'))   return `${s.replace('IN_CART_', '')} sepette`;
            if (s === 'POPULAR_NOW')        return 'Popular Right Now';
            return s;
        }).join(', ');
        salesLine = `Bu ürün ANLIK WINNER: ${signals}. Toplam ${td?.salesCount || product.sales || 0} satış, $${product.price}.`;
    } else {
        salesLine = td.salesDelta > 0
            ? `Bu ürün son 48 saatte ${td.salesDelta} adet sattı (toplam ${td.salesCount}).`
            : `Bu ürün toplamda ${td.salesCount} adet sattı ($${product.price} fiyatla).`;
    }

    const designLine = brainResult.designSuggestion
        || 'Aynı nişte daha minimalist ve premium bir stil dene.';

    const collectionAction = collection
        ? `${isInstant ? 'Hemen Üret ve' : 'Onayla ve'} ${collection.name}'na Ekle`
        : (isInstant ? 'HEMEN ÜRET — Fabrika\'ya Gönder' : 'Onayla ve Üretim Kuyruğuna Ekle');

    const priority = isInstant
        ? 'IMMEDIATE'
        : (td.salesDelta >= TRENDING_DELTA_MIN || td.salesCount >= 30) ? 'HIGH' : 'NORMAL';

    return {
        headline:              isInstant ? 'HOT NOW' : 'POTENTIAL WINNER',
        actionType:            isInstant ? 'IMMEDIATE_ACTION' : 'TREND_ACTION',
        hotNow:                isInstant || !!(td?.isHotNow),
        competitorAnalysis:    `RAKİP ANALİZİ: ${salesLine} Mağaza: ${product.shopName}.`,
        designSuggestion:      `TASARIM ÖNERİSİ: ${designLine}`,
        designPrompt:          brainResult.designPrompt ?? null,
        action:                `EYLEM: ${collectionAction}`,
        collection:            collection?.name  ?? null,
        event:                 collection?.event ?? null,
        colorPalette:          brainResult.colorPalette          ?? null,
        targetKeywords:        brainResult.targetKeywords         ?? [],
        competitiveEdge:       brainResult.competitiveEdge        ?? null,
        differentiationAngle:  brainResult.differentiationAngle   ?? null,
        confidence:            brainResult.confidence,
        priority,
        instantSignals:        isInstant ? (product._instantSignals || []) : [],
        autoSendToFactory:     isInstant,
    };
}

// ─── Persist winner to CorporateMemory ────────────────────────────────────────

async function _saveWinner(workspaceId, product, keyword, brainResult, actionCard) {
    const record = await prisma.corporateMemory.create({
        data: {
            workspaceId,
            type:     'WPI_WINNER',
            title:    `[WPI] ${actionCard.collection ? actionCard.collection + ' — ' : ''}${product.title.slice(0, 80)}`,
            content:  [
                actionCard.competitorAnalysis,
                actionCard.designSuggestion,
                actionCard.action,
            ].join('\n'),
            category: 'STRATEGY',
            isActive: true,
            tags:     [
                'wpi', keyword.toLowerCase().split(' ')[0],
                actionCard.priority.toLowerCase(),
                ...(actionCard.collection ? ['has-collection'] : []),
            ],
            analysisResult: {
                scanType:    'WPI_WINNER',
                status:      'PENDING',          // PENDING | APPROVED | REJECTED
                keyword,
                product: {
                    title:        product.title,
                    price:        product.price,
                    sales:        product.trendData.salesCount,
                    salesDelta:   product.trendData.salesDelta,
                    imageUrl:     product.imageUrl,
                    listingUrl:   product.listingUrl,
                    shopName:     product.shopName,
                    category:     product.category ?? null,
                    reviewCount:    product.reviewCount    || 0,
                    shopReviewCount: product.shopReviewCount || 0,
                    favoriteCount:  product.favoriteCount  || 0,
                    shopRating:     product.shopRating     || null,
                },
                trendData:      product.trendData,
                brainComparison: brainResult,
                actionCard,
                scannedAt:      new Date().toISOString(),
            },
        },
    });
    return record;
}

// ─── Per-keyword scanner (Promise.allSettled ile paralel çalışır) ─────────────

/**
 * Tek bir keyword için tam WPI pipeline'ı çalıştırır.
 * scan() tarafından Promise.allSettled ile paralel olarak çağrılır.
 * Her keyword kendi sonuçlarını döndürür — global state paylaşımı yok.
 */
async function _scanSingleKeyword(workspaceId, keyword, kwIdx, {
    saveWinners, maxPerKeyword, onKeywordStart, onKeywordDone, onProgress,
}) {
    if (typeof onKeywordStart === 'function') await onKeywordStart(keyword, kwIdx);
    console.log(`[WPI] Scanning keyword: "${keyword}"`);

    const kwResult = {
        keyword,
        productsScraped: 0,
        trendingCount:   0,
        winnersFound:    0,
        actionCards:     [],
        error:           null,
        timedOut:        false,
        isBaseline:      false,
    };
    const processedUrls = new Set(); // local dedup — instant + trending arasında tekrar önle

    try {
        // ── 1. Scrape (fetch hatasında 1 kez retry) ───────────────────────────
        let rawProducts;
        try {
            rawProducts = await scrapeEtsyProducts(keyword, maxPerKeyword);
        } catch (fetchErr) {
            const isNetwork = fetchErr.message?.toLowerCase().includes('fetch') ||
                              fetchErr.message?.toLowerCase().includes('network') ||
                              fetchErr.message?.toLowerCase().includes('econnreset');
            if (!isNetwork) throw fetchErr;
            console.warn(`[WPI]   ↳ "${keyword}" fetch hatası, 8s sonra retry: ${fetchErr.message}`);
            await new Promise(r => setTimeout(r, 8000));
            rawProducts = await scrapeEtsyProducts(keyword, maxPerKeyword);
        }
        console.log(`[WPI]   ↳ ${rawProducts.length} products scraped`);

        // ── 1b. Kategorize + NON_POD filtrele ─────────────────────────────────
        const categorizedRaw = rawProducts.map(p => ({ ...p, category: _categorizeProduct(p) }));
        const podProducts    = categorizedRaw.filter(p => p.category !== 'NON_POD');
        const filteredOut    = rawProducts.length - podProducts.length;
        if (filteredOut > 0) console.log(`[WPI]   ↳ ${filteredOut} NON_POD ürün elendi.`);
        kwResult.productsScraped = podProducts.length;
        if (onProgress) await onProgress(keyword, { phase: 'filtering', aiDone: 0, aiTotal: 0 });

        // ── 1c. Market bağlamı + autocomplete + scout (paralel) ───────────────
        const marketContext = _analyzeMarketContext(podProducts);
        console.log(`[WPI]   ↳ Market: ${marketContext.competitionLevel} (top5 avg reviews: ${marketContext.avgTopReviews}, avg price: $${marketContext.avgPrice})`);

        const [scoutContext, autocompleteRaw] = await Promise.all([
            _getScoutContext(workspaceId),
            expandKeywords([keyword]).catch(() => [keyword]),
        ]);
        const extras           = autocompleteRaw.filter(s => s && s !== keyword);
        const autocompleteHints = extras.length > 0 ? extras.slice(0, 8).join(', ') : null;
        if (autocompleteHints) console.log(`[WPI]   ↳ Autocomplete: ${autocompleteHints}`);
        const brainOpts = { marketContext, scoutContext, autocompleteHints };

        // ── 2. Snapshot + trending detection ──────────────────────────────────
        const [prevSnapshot] = await Promise.all([
            _loadPreviousSnapshot(workspaceId, keyword),
            saveWinners ? _saveSnapshot(workspaceId, keyword, podProducts) : Promise.resolve(),
        ]);

        const products   = _detectTrending(podProducts, prevSnapshot);
        const isBaseline = !prevSnapshot;
        const trending   = products.filter(p => p.trendData.isTrending);
        kwResult.trendingCount = trending.length;
        kwResult.isBaseline    = isBaseline;

        if (isBaseline) {
            const hotNowCount = products.filter(p => p.trendData.isHotNow).length;
            console.log(`[WPI]   ↳ BASELINE — ${podProducts.length} ürün. ${hotNowCount} HOT NOW sinyal.`);
        } else {
            console.log(`[WPI]   ↳ ${trending.length} trending ürün`);
        }

        // ── 3. Instant candidates ─────────────────────────────────────────────
        const instantCandidates = _detectInstantWinners(podProducts);
        console.log(`[WPI]   ↳ ${instantCandidates.length} instant winner aday`);

        // ── PRE-FILTER: trending → sadece sales > AI_MIN_SALES ───────────────
        const trendingForAI = trending.filter(p =>
            (p.sales ?? p.trendData?.salesCount ?? 0) > AI_MIN_SALES
        );
        const skippedPreFilter = trending.length - trendingForAI.length;
        if (skippedPreFilter > 0)
            console.log(`[WPI]   ↳ Pre-filter: ${skippedPreFilter} trending ürün elendi`);

        const instantSlice = instantCandidates.slice(0, MAX_WINNERS_PER_KW);
        const aiTotal      = instantSlice.length + Math.min(trendingForAI.length, MAX_WINNERS_PER_KW);
        let   aiDone       = 0;
        if (onProgress) await onProgress(keyword, { phase: 'ai_analysis', aiDone: 0, aiTotal });

        let winnersThisKw = 0;

        // ── 3a. Parallel instant brain analysis ───────────────────────────────
        const instantResults = await _processChunks(instantSlice, AI_CHUNK_SIZE, async (product) => {
            if (!product.trendData) {
                product.trendData = {
                    salesCount: product.sales || 0, salesDelta: 0,
                    trendPeriod: 'INSTANT', isTrending: false, isBaseline, trendScore: product.sales || 0,
                };
            }
            const productKey  = product.listingUrl || product.url || '';
            const cached      = await _getCachedBrain(productKey, keyword);
            const brainResult = cached || await _compareWithBrainInstant(product, keyword, workspaceId, brainOpts);
            if (!cached && brainResult.confidence > 0) await _setCachedBrain(productKey, keyword, brainResult);
            aiDone++;
            if (onProgress) await onProgress(keyword, { phase: 'ai_analysis', aiDone, aiTotal });
            console.log(`[WPI-Instant]   ↳ "${product.title.slice(0, 40)}" ${brainResult.confidence}%${cached ? ' [cache]' : ''}`);
            return { product, brainResult };
        });

        for (const { product, brainResult } of instantResults) {
            if (winnersThisKw >= MAX_WINNERS_PER_KW) break;
            if (brainResult.confidence < BRAIN_CONFIDENCE_MIN) continue;
            const url = product.listingUrl || product.url || '';
            if (processedUrls.has(url)) continue;
            processedUrls.add(url);

            const actionCard = _buildActionCard(product, keyword, brainResult, { isInstant: true });
            const entry = {
                keyword,
                product: {
                    title: product.title, price: product.price, sales: product.sales || 0, salesDelta: 0,
                    imageUrl: product.imageUrl, listingUrl: product.listingUrl, shopName: product.shopName,
                    category: product.category ?? null, isBestSeller: product.isBestSeller,
                    inCartCount: product.inCartCount, isPopularNow: product.isPopularNow,
                    reviewCount: product.reviewCount || 0, shopReviewCount: product.shopReviewCount || 0,
                    favoriteCount: product.favoriteCount || 0, shopRating: product.shopRating || null,
                    ..._computeEhunterMetrics(product),
                },
                trendData: product.trendData, brainComparison: brainResult, actionCard,
            };
            if (saveWinners) {
                const record = await _saveWinner(workspaceId, product, keyword, brainResult, actionCard);
                entry.id = record.id;
            }
            kwResult.actionCards.push(entry);
            winnersThisKw++;
        }

        // ── 4. Parallel trending brain analysis ───────────────────────────────
        const trendingSlice = trendingForAI
            .filter(p => !processedUrls.has(p.listingUrl || p.url || ''))
            .slice(0, MAX_WINNERS_PER_KW - winnersThisKw);

        const trendingResults = await _processChunks(trendingSlice, AI_CHUNK_SIZE, async (product) => {
            const productKey  = product.listingUrl || product.url || '';
            const cached      = await _getCachedBrain(productKey, keyword);
            const brainResult = cached || await _compareWithBrain(product, keyword, workspaceId, brainOpts);
            if (!cached && brainResult.confidence > 0) await _setCachedBrain(productKey, keyword, brainResult);
            aiDone++;
            if (onProgress) await onProgress(keyword, { phase: 'ai_analysis', aiDone, aiTotal });
            console.log(`[WPI]   ↳ Brain "${product.title.slice(0, 40)}": ${brainResult.confidence}%${cached ? ' [cache]' : ''}`);
            return { product, brainResult };
        });

        for (const { product, brainResult } of trendingResults) {
            if (winnersThisKw >= MAX_WINNERS_PER_KW) break;
            if (brainResult.confidence < BRAIN_CONFIDENCE_MIN) continue;
            const url = product.listingUrl || product.url || '';
            if (processedUrls.has(url)) continue;
            processedUrls.add(url);

            const actionCard = _buildActionCard(product, keyword, brainResult);
            const entry = {
                keyword,
                product: {
                    title: product.title, price: product.price,
                    sales: product.trendData.salesCount, salesDelta: product.trendData.salesDelta,
                    imageUrl: product.imageUrl, listingUrl: product.listingUrl,
                    shopName: product.shopName, category: product.category ?? null,
                    reviewCount: product.reviewCount || 0, shopReviewCount: product.shopReviewCount || 0,
                    favoriteCount: product.favoriteCount || 0, shopRating: product.shopRating || null,
                    ..._computeEhunterMetrics({ ...product, sales: product.trendData.salesCount }),
                },
                trendData: product.trendData, brainComparison: brainResult, actionCard,
            };
            if (saveWinners) {
                const record = await _saveWinner(workspaceId, product, keyword, brainResult, actionCard);
                entry.id = record.id;
            }
            kwResult.actionCards.push(entry);
            winnersThisKw++;
        }

        // ── 5. OPPORTUNITY fallback: sinyal yoksa (baseline veya düşük kaliteli scrape) en iyi ürünleri analiz et ─
        if (winnersThisKw === 0 && podProducts.length > 0) {
            const BASELINE_TOP_N = 5;
            // Sales verisi yoksa reviewCount/favoriteCount ile sırala — Apify her zaman satış döndürmüyor
            // URL başına tek ürün (dedup) — aynı listing'i tekrar tekrar analiz ettirme
            const seenUrls = new Set();
            const topBySales = [...podProducts]
                .sort((a, b) => {
                    // Prefer listing-level reviews; fall back to shopReviewCount (shop-wide) for getdataforme
                    const revA = (a.reviewCount ?? 0) || (a.shopReviewCount ?? 0);
                    const revB = (b.reviewCount ?? 0) || (b.shopReviewCount ?? 0);
                    const scoreA = revA * 10 + (a.favoriteCount ?? 0) * 5 + (a.sales ?? 0) * 2;
                    const scoreB = revB * 10 + (b.favoriteCount ?? 0) * 5 + (b.sales ?? 0) * 2;
                    return scoreB - scoreA;
                })
                .filter(p => {
                    const key = p.listingUrl || p.title;
                    if (seenUrls.has(key)) return false;
                    seenUrls.add(key);
                    return true;
                })
                .slice(0, BASELINE_TOP_N);

            console.log(`[WPI]   ↳ BASELINE FALLBACK: top ${topBySales.length} ürün AI'ya gönderiliyor`);
            if (onProgress) await onProgress(keyword, { phase: 'ai_analysis', aiDone: 0, aiTotal: topBySales.length });

            let bfDone = 0;
            const bfResults = await _processChunks(topBySales, AI_CHUNK_SIZE, async (product) => {
                if (!product.trendData) {
                    product.trendData = {
                        salesCount: product.sales || 0, salesDelta: 0,
                        trendPeriod: 'BASELINE', isTrending: false, isBaseline: true, trendScore: product.sales || 0,
                    };
                }

                // Fallback actor (automation-lab) sadece başlık+fiyat döndürür — sinyalsiz de analiz yap
                const productKey  = product.listingUrl || product.url || '';
                const cached      = await _getCachedBrain(productKey, keyword);
                const brainResult = cached || await _compareWithBrain(product, keyword, workspaceId, brainOpts);
                if (!cached && brainResult.confidence > 0) await _setCachedBrain(productKey, keyword, brainResult);
                bfDone++;
                if (onProgress) await onProgress(keyword, { phase: 'ai_analysis', aiDone: bfDone, aiTotal: topBySales.length });
                console.log(`[WPI-BF]   ↳ "${product.title.slice(0, 40)}" ${brainResult.confidence}%`);
                return { product, brainResult };
            });

            // Baseline için eşiği düşür — automation-lab sinyalsiz veri döndürür (0 review/sales)
            const BF_CONFIDENCE_MIN = 45;
            for (const { product, brainResult } of bfResults) {
                if (winnersThisKw >= MAX_WINNERS_PER_KW) break;
                if (brainResult.confidence < BF_CONFIDENCE_MIN) continue;
                const url = product.listingUrl || product.url || '';
                if (processedUrls.has(url)) continue;
                processedUrls.add(url);

                // actionCard'ı OPPORTUNITY olarak işaretle
                const actionCard = {
                    ..._buildActionCard(product, keyword, brainResult),
                    headline:   'MARKET OPPORTUNITY',
                    actionType: 'OPPORTUNITY',
                };
                const entry = {
                    keyword,
                    product: {
                        title: product.title, price: product.price,
                        sales: product.sales || 0, salesDelta: 0,
                        imageUrl: product.imageUrl, listingUrl: product.listingUrl,
                        shopName: product.shopName, category: product.category ?? null,
                        reviewCount: product.reviewCount || 0, shopReviewCount: product.shopReviewCount || 0,
                        favoriteCount: product.favoriteCount || 0, shopRating: product.shopRating || null,
                        ..._computeEhunterMetrics(product),
                    },
                    trendData: product.trendData, brainComparison: brainResult, actionCard,
                };
                if (saveWinners) {
                    const record = await _saveWinner(workspaceId, product, keyword, brainResult, actionCard);
                    entry.id = record.id;
                }
                kwResult.actionCards.push(entry);
                winnersThisKw++;
            }
            console.log(`[WPI]   ↳ BASELINE FALLBACK: ${winnersThisKw} kart üretildi`);
        }

        kwResult.winnersFound = kwResult.actionCards.length;
    } catch (err) {
        console.error(`[WPI] Error scanning "${keyword}": ${err.message}`);
        kwResult.error    = err.message;
        kwResult.timedOut = err.message?.toLowerCase().includes('timeout') ||
                            err.message?.toLowerCase().includes('timed-out');
    }

    if (typeof onKeywordDone === 'function') await onKeywordDone(keyword, kwIdx, { timedOut: kwResult.timedOut });
    return kwResult;
}

// ─── Main scan entry point ─────────────────────────────────────────────────────

/**
 * Runs a full WPI scan for the given keywords.
 *
 * @param {string}   workspaceId
 * @param {string[]} keywords       — product niches / search queries
 * @param {object}   [options]
 * @param {boolean}  [options.saveWinners=true]  — persist action cards to DB
 * @param {number}   [options.maxPerKeyword=50]  — products scraped per keyword
 * @returns {object}  { scanId, keywords, summary, byKeyword, actionCards }
 */
async function scan(workspaceId, keywords = [], options = {}) {
    const {
        saveWinners    = true,
        maxPerKeyword  = MAX_PRODUCTS_PER_KW,
        onKeywordStart = null,
        onKeywordDone  = null,
        onProgress     = null,   // (keyword, { phase, aiDone, aiTotal }) → void
    } = options;
    const scanId = `wpi_${Date.now()}`;

    console.log(`[WPI] 🔍 Starting scan ${scanId} | keywords: ${keywords.join(', ')}`);

    const allActionCards = [];
    const byKeyword      = {};
    const errors         = [];
    const callbackOpts   = { saveWinners, maxPerKeyword, onKeywordStart, onKeywordDone, onProgress };

    // KEYWORD_CONCURRENCY keyword'ü paralel tara — bir batch biterken diğeri başlar
    for (let i = 0; i < keywords.length; i += KEYWORD_CONCURRENCY) {
        const batch   = keywords.slice(i, i + KEYWORD_CONCURRENCY);
        const settled = await Promise.allSettled(
            batch.map((kw, j) => _scanSingleKeyword(workspaceId, kw, i + j, callbackOpts))
        );

        for (const [j, outcome] of settled.entries()) {
            const kw = batch[j];
            if (outcome.status === 'fulfilled') {
                byKeyword[kw] = outcome.value;
                allActionCards.push(...outcome.value.actionCards);
            } else {
                const errMsg = outcome.reason?.message || 'Bilinmeyen hata';
                const timedOut = errMsg.toLowerCase().includes('timeout') || errMsg.toLowerCase().includes('timed');
                byKeyword[kw] = { keyword: kw, productsScraped: 0, trendingCount: 0, winnersFound: 0, actionCards: [], error: errMsg, timedOut };
                errors.push({ keyword: kw, error: errMsg, timedOut });
                if (typeof onKeywordDone === 'function') await onKeywordDone(kw, i + j, { timedOut });
            }
        }
    }

    const summary = {
        scanId,
        scannedAt:       new Date().toISOString(),
        keywordsScanned: keywords.length,
        totalProducts:   Object.values(byKeyword).reduce((s, k) => s + k.productsScraped, 0),
        totalTrending:   Object.values(byKeyword).reduce((s, k) => s + k.trendingCount, 0),
        totalWinners:    allActionCards.length,
        totalImmediate:  allActionCards.filter(c => c.actionCard?.actionType === 'IMMEDIATE_ACTION').length,
        errors:          errors.length,
    };

    console.log(`[WPI] ✓ Scan complete: ${summary.totalWinners} action cards from ${summary.totalProducts} products`);

    return { scanId, summary, byKeyword, actionCards: allActionCards };
}

// ─── Action card CRUD ──────────────────────────────────────────────────────────

/**
 * List pending WPI action cards for a workspace.
 */
async function listActionCards(workspaceId, { status = 'PENDING', limit = 20 } = {}) {
    const records = await prisma.corporateMemory.findMany({
        where: {
            workspaceId,
            type: 'WPI_WINNER',
        },
        orderBy: { createdAt: 'desc' },
        take:    limit,
    });

    return records
        .filter(r => {
            const s = r.analysisResult?.status ?? 'PENDING';
            return status === 'ALL' || s === status;
        })
        .map(r => ({
            id:              r.id,
            title:           r.title,
            createdAt:       r.createdAt,
            status:          r.analysisResult?.status ?? 'PENDING',
            keyword:         r.analysisResult?.keyword,
            product:         r.analysisResult?.product,
            trendData:       r.analysisResult?.trendData,
            brainComparison: r.analysisResult?.brainComparison,
            actionCard:      r.analysisResult?.actionCard,
        }));
}

/**
 * Approve a WPI action card.
 * IMMEDIATE_ACTION kartlar → sendToFactory=false gelse bile otomatik fabrikaya gider.
 * TREND_ACTION kartlar → sendToFactory=true gönderilirse fabrikaya gider.
 */
async function approveActionCard(workspaceId, cardId, { sendToFactory = false } = {}) {
    const record = await prisma.corporateMemory.findFirst({
        where: { id: cardId, workspaceId, type: 'WPI_WINNER' },
    });
    if (!record) throw new Error('Action card not found');

    const ac            = record.analysisResult?.actionCard ?? {};
    const isImmediate   = ac.actionType === 'IMMEDIATE_ACTION' || ac.autoSendToFactory === true;
    const shouldFactory = sendToFactory || isImmediate;

    await prisma.corporateMemory.update({
        where: { id: cardId },
        data:  {
            analysisResult: {
                ...record.analysisResult,
                status:         'APPROVED',
                approvedAt:     new Date().toISOString(),
                sentToFactory:  shouldFactory,
            },
        },
    });

    let jobId = null;
    if (shouldFactory) {
        const kw           = record.analysisResult?.keyword || '';
        const bc           = record.analysisResult?.brainComparison ?? {};
        const designPrompt = bc.designPrompt || ac.designPrompt || '';
        const style        = [ac.colorPalette, designPrompt].filter(Boolean).join(' | ');

        const job = await prisma.designJob.create({
            data: {
                workspaceId,
                status:        'PENDING',
                mode:          'wpi',          // WPI kaynaklı iş — Factory'de "Ready to Generate" görünür
                keyword:       kw,
                niche:         bc.niche                  || ac.differentiationAngle || '',
                style,
                originalImage: record.analysisResult?.product?.imageUrl || '',
            },
        });
        jobId = job.id;
        console.log(`[WPI] ✅ ${isImmediate ? 'HOT NOW' : 'Trend'} kart fabrikaya gönderildi — JobID: ${jobId}`);
    }

    return { approved: true, cardId, jobId, sentToFactory: shouldFactory, isImmediate };
}

/**
 * Reject a WPI action card.
 */
async function rejectActionCard(workspaceId, cardId, reason = '') {
    const record = await prisma.corporateMemory.findFirst({
        where: { id: cardId, workspaceId, type: 'WPI_WINNER' },
    });
    if (!record) throw new Error('Action card not found');

    await prisma.corporateMemory.update({
        where: { id: cardId },
        data:  {
            analysisResult: {
                ...record.analysisResult,
                status:     'REJECTED',
                rejectedAt: new Date().toISOString(),
                rejectReason: reason,
            },
        },
    });

    return { rejected: true, cardId };
}

// ─── Niche Scout altyapısı (ileride Pinterest/Google Trends verisiyle dolacak) ─

/**
 * _suggestNiches — Google/Pinterest trend verilerinden Etsy mikro-niş önerileri üretir.
 *
 * @param {string[]} trendTopics  — dış kaynaktan gelen trend konuları
 * @param {string}   workspaceId
 * @returns {Promise<Array<{ niche, keyword, reasoning, confidence }>>}
 *
 * TODO: scout.service.js tarafından çağrılır; şu an stub.
 */
async function _suggestNiches(trendTopics = [], workspaceId, academyContext = '') {
    if (!trendTopics.length) return [];

    const academyBlock = academyContext
        ? `\nACADEMY KURALLARI (BUNLARA AYKIRI HİÇBİR NİŞ ÖNERME):\n${academyContext}\n`
        : '';

    const prompt = `Sen bir Etsy POD pazar analisti ve niş uzmanısın.
Aşağıdaki güncel trend konularından yola çıkarak Etsy'de RekAbeti DÜŞÜK ama talebi YÜKSEK 5 MICRO-NICHE üret.

TREND KONULARI:
${trendTopics.slice(0, 20).map((t, i) => `${i + 1}. ${t}`).join('\n')}
${academyBlock}
Her micro-niche için:
- POD ürünlerine (tişört, duvar sanatı, kupa, poster) uygun olsun
- Çok geniş (halloween) veya çok dar (sadece tek şehir) olmasın
- 2026 yılına özgü fırsatları tercih et

SADECE JSON döndür:
{"niches":[
  {
    "niche": "<micro-niche adı, Türkçe>",
    "keyword": "<Etsy'de aranacak İngilizce keyword>",
    "reasoning": "<Türkçe, 1 cümle, neden fırsat>",
    "confidence": <50-100>
  }
]}`;

    try {
        const res = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001', max_tokens: 800,
            messages: [{ role: 'user', content: prompt }],
        });
        const raw   = res.content[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) return [];
        const { niches = [] } = JSON.parse(match[0]);
        return niches;
    } catch (err) {
        console.warn('[WPI _suggestNiches] AI hatası:', err.message);
        return [];
    }
}

module.exports = {
    scan,
    listActionCards,
    approveActionCard,
    rejectActionCard,
    _suggestNiches,
    BRAIN_CONFIDENCE_MIN,
    COLLECTIONS_2026,
};
