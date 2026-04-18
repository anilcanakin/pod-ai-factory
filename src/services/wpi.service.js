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

const { PrismaClient } = require('@prisma/client');
const { scrapeEtsyProducts, ApifyPaymentError } = require('./apify.service');

const prisma    = new PrismaClient();
const anthropic = require('../lib/anthropic');

// ─── Config ────────────────────────────────────────────────────────────────────
const MIN_SALES_FOR_WINNER    = 8;    // ignore products with < N sales
const TRENDING_DELTA_MIN      = 3;    // new sales in 24-48h to call "trending"
const BRAIN_CONFIDENCE_MIN    = 80;   // min % to generate an action card
const SNAPSHOT_LOOKBACK_HOURS = 72;   // compare against snapshots up to 3 days old
const MAX_PRODUCTS_PER_KW     = 50;   // products scraped per keyword
const MAX_WINNERS_PER_KW      = 5;    // cap action cards per keyword

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

// ─── Snapshot helpers (stored in CorporateMemory) ─────────────────────────────

async function _saveSnapshot(workspaceId, keyword, products) {
    const slim = products.map(p => ({
        url:     p.listingUrl,
        title:   p.title,
        sales:   p.sales,
        price:   p.price,
        shop:    p.shopName,
        img:     p.imageUrl,
    }));

    await prisma.corporateMemory.create({
        data: {
            workspaceId,
            type:     'WPI_SNAPSHOT',
            title:    `[WPI_SNAPSHOT] ${keyword}`,
            content:  `WPI scan snapshot — ${products.length} products — ${new Date().toISOString()}`,
            category: 'STRATEGY',
            isActive: false,   // snapshots are internal, don't surface in Brain UI
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
            const key = p.url || p.listingUrl || '';
            if (key) prevMap[key] = p.sales ?? 0;
        }
    }
    const hasHistory = prevSnapshot !== null && Object.keys(prevMap).length > 0;

    return products.map(p => {
        // p.sales, apify.service.js _normaliseEtsyItem tarafından
        // total_sales / sales_count / numberOfSales'dan doldurulur
        const currentSales = p.sales || 0;
        const productKey   = p.listingUrl || p.url || '';

        let salesDelta  = 0;
        let isTrending  = false;
        let isBaseline  = !hasHistory;

        if (hasHistory) {
            if (prevMap[productKey] !== undefined) {
                // Bilinen ürün — gerçek delta hesapla
                salesDelta = Math.max(0, currentSales - prevMap[productKey]);
                isTrending = salesDelta >= TRENDING_DELTA_MIN;
            }
            // Snapshot'ta olmayan yeni bir ürün → bu da trending sayılabilir
            // ama agresif false positive vermemek için konservatif kalıyoruz
        }
        // BASELINE modda isTrending = false → Action Card üretilmez

        const trendScore = hasHistory
            ? salesDelta * 10 + currentSales * 0.1   // delta ağırlıklı
            : currentSales;                            // baseline: salt satış sayısı

        return {
            ...p,
            trendData: {
                salesCount:  currentSales,
                salesDelta,
                trendPeriod: hasHistory ? '48h' : 'BASELINE',
                isTrending,
                isBaseline,
                trendScore,
            },
        };
    });
}

// ─── Instant Intelligence ─────────────────────────────────────────────────────

const INSTANT_IN_CART_MIN = 20; // minimum in_cart sayısı

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
async function _compareWithBrainInstant(product, keyword, workspaceId) {
    const [memories, seoKb] = await Promise.all([
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
    ]);

    const brainLines = memories.length > 0
        ? memories.map(m => `[${m.category}] ${m.title.slice(0, 60)}: ${m.content.slice(0, 180)}`).join('\n')
        : '(Knowledge base boş — genel Etsy POD bilgisiyle değerlendir.)';

    const seoLines = seoKb?.content ? seoKb.content.slice(0, 400) : '(SEO KB boş)';

    const signalLines = (product._instantSignals || []).map(s => {
        if (s === 'BEST_SELLER')       return '✅ Etsy Best Seller rozetine sahip';
        if (s.startsWith('IN_CART_'))  return `✅ Şu an ${s.replace('IN_CART_', '')} sepette — yoğun talep var`;
        if (s === 'POPULAR_NOW')       return '✅ "Popular Right Now" etiketiyle öne çıkarılıyor';
        return s;
    }).join('\n');

    const prompt = `Sen deneyimli bir Etsy POD stratejisti ve yaratıcı direktörsün.

RAKİP ÜRÜN — ANLIK WINNER:
- Başlık: "${product.title}"
- Fiyat: $${product.price}
- Toplam Satış: ${product.sales || 0} adet
- Mağaza: ${product.shopName}
- Niche Keyword: "${keyword}"

GÜÇLÜ SİNYALLER:
${signalLines}

BİZİM KNOWLEDGE BASE:
${brainLines}

SEO BİLGİSİ:
${seoLines}

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
  "competitiveEdge": "<Türkçe, 1 net cümle — bizim ekleyeceğimiz özgün değer>",
  "designSuggestion": "<Türkçe, 1 net cümle — rakibe göre ne yapmalıyız?>",
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

// ─── Brain comparison ──────────────────────────────────────────────────────────

/**
 * Asks Claude Haiku whether we can build a better product than the competitor.
 * Injects relevant CorporateMemory + SEO knowledge as context.
 * Returns { confidence, reasoning, designSuggestion, niche, targetKeywords,
 *           colorPalette, competitiveEdge }
 */
async function _compareWithBrain(product, keyword, workspaceId) {
    // Fetch relevant brain memories (VISUAL + STRATEGY + SEO categories)
    const [memories, seoKb] = await Promise.all([
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
    ]);

    const brainLines = memories.length > 0
        ? memories.map(m => `[${m.category}] ${m.title.slice(0, 60)}: ${m.content.slice(0, 180)}`).join('\n')
        : '(Henüz knowledge base girişi yok — genel Etsy POD bilgisiyle değerlendir.)';

    const seoLines = seoKb?.content
        ? seoKb.content.slice(0, 400)
        : '(SEO KB boş)';

    const prompt = `Sen deneyimli bir Etsy POD stratejisti ve tasarımcısısın.

RAKİP ÜRÜN ANALİZİ:
- Başlık: "${product.title}"
- Fiyat: $${product.price}
- Toplam Satış: ${product.trendData.salesCount} adet
- Son 48 saatte yeni satış: ${product.trendData.salesDelta > 0 ? product.trendData.salesDelta + ' adet' : 'Veri yok (ilk tarama)'}
- Niche Keyword: "${keyword}"
- Mağaza: ${product.shopName}

bizim KNOWLEDGE BASE:
${brainLines}

SEO BİLGİSİ:
${seoLines}

SORU: BİZ bu nişte daha iyi/farklı bir ürün yapabilir miyiz?

Değerlendirme kriterleri:
- Tasarım kalitesi fırsatı (rakip görseli sıradan mı?)
- Fiyat konumlandırma boşluğu
- KB'deki trend/stil bilgisiyle örtüşme
- Mevsimsel fırsat (Nisan 2026: 4th of July yaklaşıyor, World Cup 2026 başlıyor)

SADECE JSON döndür:
{
  "confidence": <0-100>,
  "reasoning": "<Türkçe, max 2 cümle, neden bu skoru verdik>",
  "designSuggestion": "<Türkçe, 1 net cümle, ne yapmalıyız?>",
  "niche": "<tek kelime>",
  "targetKeywords": ["<en iyi 3 Etsy keyword>"],
  "colorPalette": "<önerilen renk paleti, ör: navy blue + gold + cream>",
  "competitiveEdge": "<bizim rakibe karşı avantajımız, 1 cümle>"
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
        headline:              isInstant ? 'IMMEDIATE ACTION' : 'POTENTIAL WINNER',
        actionType:            isInstant ? 'IMMEDIATE_ACTION' : 'TREND_ACTION',
        competitorAnalysis:    `RAKİP ANALİZİ: ${salesLine} Mağaza: ${product.shopName}.`,
        designSuggestion:      `TASARIM ÖNERİSİ: ${designLine}`,
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
        autoSendToFactory:     isInstant,   // approve anında fabrikaya otomatik gider
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
                    title:      product.title,
                    price:      product.price,
                    sales:      product.trendData.salesCount,
                    salesDelta: product.trendData.salesDelta,
                    imageUrl:   product.imageUrl,
                    listingUrl: product.listingUrl,
                    shopName:   product.shopName,
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
    } = options;
    const scanId = `wpi_${Date.now()}`;

    console.log(`[WPI] 🔍 Starting scan ${scanId} | keywords: ${keywords.join(', ')}`);

    const allActionCards = [];
    const byKeyword      = {};
    const errors         = [];

    for (let _kwIdx = 0; _kwIdx < keywords.length; _kwIdx++) {
        const keyword = keywords[_kwIdx];
        if (typeof onKeywordStart === 'function') onKeywordStart(keyword, _kwIdx);
        console.log(`[WPI] Scanning keyword: "${keyword}"`);
        const kwResult = {
            keyword,
            productsScraped: 0,
            trendingCount:   0,
            winnersFound:    0,
            actionCards:     [],
            error:           null,
        };

        try {
            // ── 1. Scrape live Etsy products ──────────────────────────────────
            const rawProducts = await scrapeEtsyProducts(keyword, maxPerKeyword);
            kwResult.productsScraped = rawProducts.length;
            console.log(`[WPI]   ↳ ${rawProducts.length} products scraped`);

            // ── 2. Load previous snapshot + detect trending ───────────────────
            const [prevSnapshot] = await Promise.all([
                _loadPreviousSnapshot(workspaceId, keyword),
                saveWinners ? _saveSnapshot(workspaceId, keyword, rawProducts) : Promise.resolve(),
            ]);

            const products   = _detectTrending(rawProducts, prevSnapshot);
            const isBaseline = !prevSnapshot;
            const trending   = isBaseline ? [] : products.filter(p => p.trendData.isTrending);
            kwResult.trendingCount = trending.length;
            kwResult.isBaseline    = isBaseline;

            if (isBaseline) {
                console.log(`[WPI]   ↳ BASELINE tarama — ${rawProducts.length} ürün snapshot'a kaydedildi.`);
            } else {
                console.log(`[WPI]   ↳ ${trending.length} trending ürün (salesDelta ≥ ${TRENDING_DELTA_MIN})`);
            }

            // ── 3. INSTANT INTELLIGENCE — Baseline'da bile çalışır ───────────
            const instantCandidates = _detectInstantWinners(rawProducts);
            console.log(`[WPI]   ↳ ${instantCandidates.length} instant winner aday (best_seller/in_cart/popular)`);

            let winnersThisKw = 0;

            for (const product of instantCandidates.slice(0, MAX_WINNERS_PER_KW)) {
                if (winnersThisKw >= MAX_WINNERS_PER_KW) break;

                // Trenddata olmayabilir (baseline) — dummy ekle
                if (!product.trendData) {
                    product.trendData = {
                        salesCount:  product.sales || 0,
                        salesDelta:  0,
                        trendPeriod: 'INSTANT',
                        isTrending:  false,
                        isBaseline:  isBaseline,
                        trendScore:  product.sales || 0,
                    };
                }

                const brainResult = await _compareWithBrainInstant(product, keyword, workspaceId);
                console.log(`[WPI-Instant]   ↳ "${product.title.slice(0, 40)}" competitive edge confidence: ${brainResult.confidence}%`);

                if (brainResult.confidence < BRAIN_CONFIDENCE_MIN) continue;

                const actionCard = _buildActionCard(product, keyword, brainResult, { isInstant: true });
                const entry = {
                    keyword,
                    product: {
                        title:        product.title,
                        price:        product.price,
                        sales:        product.sales || 0,
                        salesDelta:   0,
                        imageUrl:     product.imageUrl,
                        listingUrl:   product.listingUrl,
                        shopName:     product.shopName,
                        isBestSeller: product.isBestSeller,
                        inCartCount:  product.inCartCount,
                        isPopularNow: product.isPopularNow,
                    },
                    trendData:       product.trendData,
                    brainComparison: brainResult,
                    actionCard,
                };

                if (saveWinners) {
                    const record = await _saveWinner(workspaceId, product, keyword, brainResult, actionCard);
                    entry.id = record.id;
                }

                kwResult.actionCards.push(entry);
                allActionCards.push(entry);
                winnersThisKw++;
            }

            // ── 4. Brain comparison for TRENDING products (non-baseline) ─────
            for (const product of trending.slice(0, MAX_WINNERS_PER_KW - winnersThisKw)) {
                if (winnersThisKw >= MAX_WINNERS_PER_KW) break;

                // Instant winner olarak zaten işlenmediyse
                const alreadyProcessed = allActionCards.some(
                    c => c.product.listingUrl === (product.listingUrl || product.url)
                );
                if (alreadyProcessed) continue;

                const brainResult = await _compareWithBrain(product, keyword, workspaceId);
                console.log(`[WPI]   ↳ Brain confidence for "${product.title.slice(0, 40)}": ${brainResult.confidence}%`);

                if (brainResult.confidence < BRAIN_CONFIDENCE_MIN) continue;

                const actionCard = _buildActionCard(product, keyword, brainResult);
                const entry = {
                    keyword,
                    product: {
                        title:      product.title,
                        price:      product.price,
                        sales:      product.trendData.salesCount,
                        salesDelta: product.trendData.salesDelta,
                        imageUrl:   product.imageUrl,
                        listingUrl: product.listingUrl,
                        shopName:   product.shopName,
                    },
                    trendData:       product.trendData,
                    brainComparison: brainResult,
                    actionCard,
                };

                if (saveWinners) {
                    const record = await _saveWinner(workspaceId, product, keyword, brainResult, actionCard);
                    entry.id = record.id;
                }

                kwResult.actionCards.push(entry);
                allActionCards.push(entry);
                winnersThisKw++;
            }

            kwResult.winnersFound = kwResult.actionCards.length;
        } catch (err) {
            console.error(`[WPI] Error scanning "${keyword}": ${err.message}`);
            kwResult.error = err.message;
            errors.push({ keyword, error: err.message });
        }

        byKeyword[keyword] = kwResult;
        if (typeof onKeywordDone === 'function') onKeywordDone(keyword, _kwIdx);
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
        const kw  = record.analysisResult?.keyword || '';
        const bc  = record.analysisResult?.brainComparison ?? {};
        const job = await prisma.designJob.create({
            data: {
                workspaceId,
                status:        'PENDING',
                mode:          'etsy',
                keyword:       kw,
                niche:         bc.niche            || ac.differentiationAngle || '',
                style:         ac.colorPalette     || '',
                originalImage: record.analysisResult?.product?.imageUrl || '',
            },
        });
        jobId = job.id;
        console.log(`[WPI] ✅ ${isImmediate ? 'IMMEDIATE ACTION' : 'Trend'} kart fabrikaya gönderildi — JobID: ${jobId}`);
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

module.exports = {
    scan,
    listActionCards,
    approveActionCard,
    rejectActionCard,
    BRAIN_CONFIDENCE_MIN,
    COLLECTIONS_2026,
};
