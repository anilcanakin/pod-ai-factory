/**
 * ApifyService — Starter Plan + x402 Pay-per-Usage Edition
 *
 * Actor zinciri:
 *
 *   scrapeEtsyProducts
 *     PRIMARY  → shahidirfan/etsy-scraper  (x402, USDC on Base ~$1/çağrı)
 *     FALLBACK → apify/etsy-scraper        (Starter CU — x402 hatasında sessizce devreye girer)
 *
 *   researchEtsyKeywords                   (easyapi KALDIRILDI)
 *     PRIMARY  → apify/etsy-scraper        (top ürün başlıklarından keyword mining)
 *     FALLBACK → Claude Haiku              (actor başarısız olursa semantik genişletme)
 *
 *   scrapePinterestTrends
 *     → apify/pinterest-crawler            (Starter CU)
 *
 * x402 ödeme akışı:
 *   POST → 402 → payment-required decode → EIP-3009 TransferWithAuthorization imzala →
 *   x-payment header ile retry
 *   Eğer X402_WALLET_PRIVATE_KEY yoksa OTOMATIK FALLBACK devreye girer (hata gösterilmez).
 */

const { ApifyClient }  = require('apify-client');

// APIFY_API_KEY ve APIFY_API_TOKEN her ikisini de destekle
const apify     = new ApifyClient({ token: process.env.APIFY_API_KEY || process.env.APIFY_API_TOKEN });
const prisma = require('../lib/prisma');
const anthropic = require('../lib/anthropic');

// ─── Actor IDs ────────────────────────────────────────────────────────────────
const ACTORS = {
    ETSY_PRODUCTS:    process.env.APIFY_ACTOR_ETSY          || 'shahidirfan/etsy-scraper',
    ETSY_FALLBACK:    process.env.APIFY_ACTOR_ETSY_FALLBACK  || 'apify/etsy-scraper',
    ETSY_KEYWORDS:    process.env.APIFY_ACTOR_KEYWORDS        || 'apify/etsy-scraper',
    PINTEREST:        process.env.APIFY_ACTOR_PINTEREST       || 'apify/pinterest-crawler',
};

// ─── Timeouts (saniye) ────────────────────────────────────────────────────────
// 60s ilk deneme — aşılırsa kısmi veri alınır, hata fırlatılmaz.
const TIMEOUTS = { KEYWORDS: 60, PRODUCTS: 60, PINTEREST: 60 };

// ─── Bellek (MB) ──────────────────────────────────────────────────────────────
const MEMORY = { KEYWORDS: 512, PRODUCTS: 1024, PINTEREST: 1024 };

// ─── 2026 Trend Keyword Listesi ───────────────────────────────────────────────
const TRENDS_2026 = [
    { keyword: '4th of July 250th Anniversary USA',       priority: 'HIGH',   event: '4th of July 2026 — 250th Anniversary' },
    { keyword: 'American Revolution aesthetic wall art',  priority: 'HIGH',   event: '4th of July 2026 — 250th Anniversary' },
    { keyword: 'patriotic 1776 poster print',             priority: 'HIGH',   event: '4th of July 2026 — 250th Anniversary' },
    { keyword: 'FIFA World Cup 2026 soccer gift',         priority: 'HIGH',   event: 'FIFA World Cup 2026' },
    { keyword: 'World Cup USA Mexico Canada fan shirt',   priority: 'HIGH',   event: 'FIFA World Cup 2026' },
    { keyword: 'soccer mom World Cup 2026',               priority: 'HIGH',   event: 'FIFA World Cup 2026' },
    { keyword: 'Mothers Day 2026 personalized gift',      priority: 'HIGH',   event: "Mother's Day 2026 (May 10)" },
    { keyword: 'floral mom minimalist wall art',          priority: 'NORMAL', event: "Mother's Day 2026 (May 10)" },
    { keyword: 'back to school teacher appreciation',     priority: 'NORMAL', event: 'Back to School 2026' },
    { keyword: 'Halloween gothic aesthetic wall art',     priority: 'NORMAL', event: 'Halloween 2026' },
];

// ─── Error sınıfları ──────────────────────────────────────────────────────────

class ApifyPaymentError extends Error {
    constructor(msg) { super(msg); this.name = 'ApifyPaymentError'; }
}

class X402ConfigError extends Error {
    constructor(msg) { super(msg); this.name = 'X402ConfigError'; }
}

// ─── x402 Ödeme İmzalayıcı ───────────────────────────────────────────────────

async function _buildX402PaymentHeader(requirements) {
    const privateKey = process.env.X402_WALLET_PRIVATE_KEY;
    if (!privateKey) {
        throw new X402ConfigError(
            'X402_WALLET_PRIVATE_KEY tanımlı değil — Fallback devreye giriyor.'
        );
    }

    const { ethers } = require('ethers');
    const wallet  = new ethers.Wallet(privateKey);
    const accept  = requirements.accepts?.[0];
    if (!accept) throw new Error('x402: ödeme seçeneği bulunamadı');

    const chainId = parseInt(accept.network.split(':')[1], 10);

    const domain = {
        name:              accept.extra?.name    || 'USD Coin',
        version:           accept.extra?.version || '2',
        chainId,
        verifyingContract: accept.asset,
    };

    const types = {
        TransferWithAuthorization: [
            { name: 'from',        type: 'address' },
            { name: 'to',          type: 'address' },
            { name: 'value',       type: 'uint256' },
            { name: 'validAfter',  type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce',       type: 'bytes32' },
        ],
    };

    const validBefore = Math.floor(Date.now() / 1000) + (accept.maxTimeoutSeconds || 60);
    const nonce       = ethers.utils.hexlify(ethers.utils.randomBytes(32));

    const authorization = {
        from: wallet.address, to: accept.payTo,
        value: accept.amount, validAfter: 0, validBefore, nonce,
    };

    const signature = await wallet._signTypedData(domain, types, authorization);

    const payment = {
        x402Version: requirements.x402Version || 2,
        scheme:      accept.scheme,
        network:     accept.network,
        payload: {
            signature,
            authorization: {
                ...authorization,
                value:       String(authorization.value),
                validAfter:  String(authorization.validAfter),
                validBefore: String(authorization.validBefore),
            },
        },
    };

    return Buffer.from(JSON.stringify(payment)).toString('base64');
}

// ─── x402 destekli HTTP runner ────────────────────────────────────────────────

async function _runActorWithX402(actorId, input, { waitSecs = 300, memory = 1024, maxItems } = {}) {
    const token     = process.env.APIFY_API_KEY || process.env.APIFY_API_TOKEN;
    const actorSlug = actorId.replace('/', '~');
    // maxItems Apify run seçeneğidir — aktör input body'sine DEĞİL URL'ye eklenir
    const maxItemsParam = maxItems ? `&maxItems=${maxItems}` : '';
    const url       = `https://api.apify.com/v2/acts/${actorSlug}/run-sync-get-dataset-items` +
                      `?token=${token}&timeout=${waitSecs}&memory=${memory}${maxItemsParam}`;

    console.log(`[Apify x402] ▶ ${actorId} | input:`, JSON.stringify(input).slice(0, 200));

    const makeRequest = async (extraHeaders = {}) =>
        fetch(url, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', ...extraHeaders },
            body:    JSON.stringify(input),
        });

    let res = await makeRequest();

    if (res.status === 402) {
        const paymentHeader = res.headers.get('payment-required')
                           || res.headers.get('x-payment-required');

        if (!paymentHeader) {
            throw new ApifyPaymentError(`${actorId} 402 döndürdü ama payment-required header yok.`);
        }

        let requirements;
        try {
            requirements = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'));
        } catch {
            throw new ApifyPaymentError(`payment-required header decode edilemedi.`);
        }

        console.log(`[Apify x402] 💳 Ödeme gerekli — ${requirements.accepts?.[0]?.amount} ${requirements.accepts?.[0]?.network}`);

        const xPayment = await _buildX402PaymentHeader(requirements);
        res = await makeRequest({ 'x-payment': xPayment });

        if (res.status === 402) {
            const errText = await res.text().catch(() => '');
            throw new ApifyPaymentError(
                `x402 ödeme reddedildi. Base L2 USDC bakiyesini kontrol et. Detay: ${errText.slice(0, 200)}`
            );
        }
    }

    if (!res.ok) {
        const errText = await res.text().catch(() => '(body yok)');
        throw new Error(`[Apify x402] ${actorId} HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }

    const body  = await res.json();
    const items = Array.isArray(body) ? body : (body?.data?.items ?? body?.items ?? []);
    console.log(`[Apify x402] ✓ ${actorId} → ${items.length} öğe`);
    return items;
}

// ─── Standart SDK runner ──────────────────────────────────────────────────────

async function _runActor(actorId, input, { waitSecs = 60, memory = 1024, maxItems } = {}) {
    // Timeout 60s — aşılırsa kısmi dataset okunur, hata fırlatılmaz.
    const runOptions = { waitSecs: Math.min(waitSecs, 60), memory, ...(maxItems ? { maxItems } : {}) };
    console.log(`[Apify] ▶ ${actorId} | memory:${memory}MB | timeout:${runOptions.waitSecs}s${maxItems ? ` | maxItems:${maxItems}` : ''} | input:`, JSON.stringify(input).slice(0, 200));

    let run;
    try {
        run = await apify.actor(actorId).call(input, runOptions);
    } catch (callErr) {
        if (callErr.message?.includes('PAYMENT-SIGNATURE') ||
            callErr.message?.includes('x402') ||
            callErr.statusCode === 402) {
            throw new ApifyPaymentError(`${actorId} x402 ödeme gerektiriyor: ${callErr.message}`);
        }
        throw callErr;
    }

    if (run.status === 'TIMED-OUT') {
        // Arka planda çalışmaya devam ediyor — şimdiye kadar toplanan kısmi verileri al
        console.warn(`[Apify] ⚠ ${run.id} 60s timeout — kısmi dataset alınıyor (run arka planda devam ediyor)...`);
        try {
            const { items } = await apify.dataset(run.defaultDatasetId).listItems();
            console.log(`[Apify] ↳ ${items.length} kısmi öğe (runId: ${run.id})`);
            return items;
        } catch {
            console.warn(`[Apify] ↳ Kısmi veri alınamadı — boş dizi döndürülüyor.`);
            return [];
        }
    }

    if (run.status !== 'SUCCEEDED') {
        throw new Error(`[Apify] Run ${run.id} durumu: ${run.status}`);
    }

    const { items } = await apify.dataset(run.defaultDatasetId).listItems();
    console.log(`[Apify] ✓ ${actorId} → ${items.length} öğe (runId: ${run.id})`);
    return items;
}

// ─── Normalizer ───────────────────────────────────────────────────────────────
// shahidirfan ve apify/etsy-scraper farklı field isimleri kullanabilir.
// total_sales, sales_count, numberOfSales hepsini yakala.

function _normaliseEtsyItem(item) {
    const sales = item.total_sales     // shahidirfan birincil alan
               ?? item.sales_count     // alternatif
               ?? item.numberOfSales   // apify/etsy-scraper
               ?? item.sales
               ?? 0;

    const listingId = item.listing_id  // shahidirfan
                   ?? item.listingId
                   ?? item.id
                   ?? '';

    const imageUrl  = (Array.isArray(item.images) ? item.images[0] : null)
                   ?? item.imageUrl ?? item.image ?? '';

    return {
        listingId,
        title:        item.title      || item.name       || '',
        price:        parseFloat(item.price?.amount ?? item.price ?? 0),
        currency:     item.price?.currency               ?? 'USD',
        imageUrl,
        listingUrl:   item.url        || item.listingUrl  || '',
        sales,
        rating:       item.rating                        ?? null,
        shopName:     item.shop?.name ?? item.shopName   ?? '',
        // ── Instant Intelligence signals ─────────────────────────────────
        isBestSeller: !!(item.is_best_seller ?? item.isBestSeller ?? item.bestseller ?? false),
        inCartCount:  parseInt(item.in_cart ?? item.inCart ?? item.in_carts ?? item.inCartCount ?? 0, 10),
        isPopularNow: !!(item.is_popular_now ?? item.isPopularNow ?? item.popularNow ?? item.is_popular ?? false),
    };
}

// ─── 1. Etsy Ürün Scraper ─────────────────────────────────────────────────────
//
// PRIMARY  → shahidirfan/etsy-scraper  (x402)
//   input  : { searchQuery, maxItems }
//
// FALLBACK → apify/etsy-scraper (Starter CU)
//   input  : { search, maxItems }
//   tetikleyici: X402ConfigError (wallet key yok) veya ApifyPaymentError

async function scrapeEtsyProducts(keyword, maxResults = 50) {
    // ── Primary ───────────────────────────────────────────────────────────────
    try {
        const items = await _runActorWithX402(
            ACTORS.ETSY_PRODUCTS,
            { searchQuery: keyword },                           // input body — sadece aktörün tanıdığı alanlar
            { waitSecs: TIMEOUTS.PRODUCTS, memory: MEMORY.PRODUCTS, maxItems: maxResults }  // maxItems URL param olarak gider
        );
        console.log(`[Apify] ✓ Primary scraper: ${items.length} ürün / "${keyword}"`);
        return items.map(_normaliseEtsyItem);
    } catch (primaryErr) {
        const isPaymentIssue = primaryErr instanceof X402ConfigError
                            || primaryErr instanceof ApifyPaymentError;
        if (!isPaymentIssue) throw primaryErr;

        // Sessiz fallback — kullanıcıya hata gösterme
        console.log(
            `[Apify] ⚡ Fallback devreye girdi — ${ACTORS.ETSY_FALLBACK} ` +
            `(Neden: ${primaryErr.constructor.name})`
        );
    }

    // ── Fallback ──────────────────────────────────────────────────────────────
    const fallbackItems = await _runActor(
        ACTORS.ETSY_FALLBACK,
        { search: keyword },
        { waitSecs: TIMEOUTS.PRODUCTS, memory: MEMORY.PRODUCTS, maxItems: maxResults }
    );
    console.log(`[Apify] ✓ Fallback scraper: ${fallbackItems.length} ürün / "${keyword}"`);
    return fallbackItems.map(_normaliseEtsyItem);
}

// ─── 2. Pinterest Trend Scraper ───────────────────────────────────────────────

async function scrapePinterestTrends(keyword, maxResults = 30) {
    const items = await _runActor(
        ACTORS.PINTEREST,
        { queries: [keyword], maxResults, searchType: 'pins' },
        { waitSecs: TIMEOUTS.PINTEREST, memory: MEMORY.PINTEREST }
    );

    return items.map(item => ({
        title:       item.title       || item.name           || keyword,
        imageUrl:    item.imageUrl    || item.image?.url     || item.images?.orig?.url || '',
        pinUrl:      item.url         || item.link           || '',
        description: item.description || '',
        repins:      item.repinCount  ?? item.repin_count    ?? 0,
    }));
}

// ─── 3. Etsy Keyword Research (easyapi KALDIRILDI) ────────────────────────────
//
// Yeni yaklaşım: apify/etsy-scraper ile top 30 ürün çek,
// başlıklardan anlamlı keyword pattern'leri mine et.
// Avantaj: Gerçek Etsy verisi, sahte volume yok.

async function _mineKeywordsFromTitles(products, seedKeywords) {
    if (!products.length) return [];

    const allTitles = products.map(p => p.title).join('\n');
    const prompt    = `Aşağıdaki Etsy ürün başlıklarını analiz et ve içlerinden en değerli long-tail keyword'leri çıkar.

SEED KEYWORD'LER: ${seedKeywords.join(', ')}

ETSY BAŞLIKLARI (top ${products.length} ürün):
${allTitles.slice(0, 3000)}

Kurallar:
- Seed keyword'lerle alakalı, ama daha spesifik/uzun keyword'ler bul
- POD ürünlerine uygun (wall art, shirt, mug, poster, gift vb.)
- Her seed için 5 keyword üret
- Gerçekten Etsy'de aranıyor olsun (başlıklarda gördüklerine bağlı kal)

SADECE JSON döndür:
{"keywords":[{"keyword":"...","frequency":<başlıklarda kaç kez geçti>,"source":"etsy_titles"}]}`;

    const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
    });

    const raw   = res.content[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return [];

    try {
        const { keywords = [] } = JSON.parse(match[0]);
        return keywords.map(k => ({
            keyword:      k.keyword,
            searchVolume: 0,                    // başlık mining'de volume yok
            competition:  'unknown',
            trend:        null,
            cpc:          null,
            relatedTerms: [],
            source:       'etsy_titles',
            frequency:    k.frequency || 0,
        }));
    } catch {
        return [];
    }
}

async function _claudeKeywordExpansionFallback(kwArray) {
    console.log('[Apify] ⚠ Claude Haiku fallback — arama hacmi verisi yok.');
    const prompt = `Sen bir Etsy SEO uzmanısın. Aşağıdaki seed keyword'ler için alıcı niyetiyle yazılmış long-tail keyword'ler üret.

SEED KEYWORD'LER: ${kwArray.join(', ')}

Kurallar:
- Her seed için 5-7 varyasyon
- POD ürünlerine uygun (wall art, shirt, mug, poster, decor, gift vb.)
- Buyer intent içersin
- Mevsimsel/etkinlik bağlamlı keyword'lere öncelik ver

SADECE JSON:
{"expanded":[{"seed":"<keyword>","suggestions":["<kw1>","<kw2>","<kw3>","<kw4>","<kw5>"]}]}`;

    const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(raw); } catch {
        const m = raw.match(/\{[\s\S]*\}/);
        parsed  = m ? JSON.parse(m[0]) : { expanded: [] };
    }

    const results = [];
    for (const group of (parsed.expanded || [])) {
        results.push({
            keyword: group.seed, searchVolume: 0, competition: 'unknown',
            trend: null, cpc: null, relatedTerms: group.suggestions || [],
            source: 'claude_expansion',
        });
        for (const [i, sug] of (group.suggestions || []).entries()) {
            results.push({
                keyword: sug, searchVolume: 0, competition: 'unknown',
                trend: null, cpc: null, relatedTerms: [], source: 'claude_expansion', rank: i + 1,
            });
        }
    }
    return results;
}

/**
 * PRIMARY  → apify/etsy-scraper üzerinden başlık mining (gerçek Etsy verisi)
 * FALLBACK → Claude Haiku semantik genişletme
 * NOT: easyapi/etsy-keywords-research-tool tamamen kaldırıldı.
 */
async function researchEtsyKeywords(keywords, countryCode = 'US') {
    const kwArray = Array.isArray(keywords) ? keywords : [keywords];

    // ── Primary: apify/etsy-scraper → başlık mining ───────────────────────────
    try {
        // Tüm seed keyword'leri birleştirip bir tarama yap
        const combinedQuery = kwArray.join(' ');
        const products = await _runActor(
            ACTORS.ETSY_KEYWORDS,
            { search: combinedQuery },
            { waitSecs: TIMEOUTS.KEYWORDS, memory: MEMORY.KEYWORDS, maxItems: 30 }
        );

        if (products.length > 0) {
            const normalised = products.map(_normaliseEtsyItem);
            const mined      = await _mineKeywordsFromTitles(normalised, kwArray);
            if (mined.length > 0) {
                console.log(`[Apify] ✓ Keyword mining: ${mined.length} keyword (${products.length} başlıktan)`);
                return mined;
            }
        }

        console.warn('[Apify] Keyword mining sıfır sonuç — Claude fallback.');
    } catch (err) {
        if (err instanceof ApifyPaymentError) throw err;
        console.warn(`[Apify] Keyword actor hatası: ${err.message} — Claude fallback.`);
    }

    // ── Fallback: Claude Haiku ────────────────────────────────────────────────
    const results = await _claudeKeywordExpansionFallback(kwArray);
    console.log(`[Apify] Claude fallback → ${results.length} keyword`);
    return results;
}

// ─── 4. Pinterest Trends → VISUAL_TRENDS Knowledge ───────────────────────────

async function savePinterestTrendsToKnowledge(trends, workspaceId, keyword) {
    console.log(`[Apify] ${Math.min(trends.length, 15)} Pinterest trend analiz ediliyor: ${keyword}`);
    let saved = 0;
    const enrichedTrends = [];

    await prisma.workspace.upsert({
        where:  { id: workspaceId },
        update: {},
        create: { id: workspaceId, name: 'Default Workspace', slug: workspaceId },
    });

    for (const pin of trends.slice(0, 15)) {
        const enriched = { ...pin, visionInsight: null, designPrompt: null };

        if (!pin.imageUrl) {
            enrichedTrends.push(enriched);
            continue;
        }

        let visualInsight = `Pinterest trend pin: "${pin.title}" — ${pin.repins} repin.`;
        let designPrompt  = null;

        try {
            const response = await anthropic.messages.create({
                model: 'claude-haiku-4-5-20251001', max_tokens: 400,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'image', source: { type: 'url', url: pin.imageUrl } },
                        { type: 'text', text: `Bu Pinterest trend görselini Etsy POD perspektifinden analiz et ve JSON döndür.

{"vision":"<2 Türkçe cümle: renk paleti, kompozisyon stili, ürün tipi uyumu (duvar sanatı/tişört/kuppa vb.), öne çıkan tasarım öğeleri>","prompt":"<1 İngilizce Flux/Ideogram generation prompt — bu görselin tasarım dilini Etsy POD ürününe uyarlayan sahne/stil/renk tarifi>"}` },
                    ],
                }],
            });

            const raw   = response.content[0].text;
            const match = raw.match(/\{[\s\S]*\}/);
            if (match) {
                const parsed = JSON.parse(match[0]);
                visualInsight = parsed.vision  || visualInsight;
                designPrompt  = parsed.prompt  || null;
            }
        } catch (visionErr) {
            console.warn('[Apify] Vision analiz hatası:', visionErr.message);
        }

        enriched.visionInsight = visualInsight;
        enriched.designPrompt  = designPrompt;
        enrichedTrends.push(enriched);

        try {
            await prisma.corporateMemory.create({
                data: {
                    workspaceId,
                    type:     'STRATEGIC_RULE',
                    title:    `[VISUAL_TRENDS] ${keyword} — ${pin.title.slice(0, 80)}`,
                    content:  `${visualInsight}${designPrompt ? `\n\nÖnerilen prompt: ${designPrompt}` : ''}`,
                    category: 'VISUAL',
                    isActive: true,
                    analysisResult: {
                        ruleCategory: 'VISUAL_TRENDS', domain: 'VISUAL', priority: 'NORMAL',
                        keyword, pinUrl: pin.pinUrl, imageUrl: pin.imageUrl,
                        repins: pin.repins, designPrompt, extractedAt: new Date().toISOString(),
                    },
                },
            });
            saved++;
        } catch (dbErr) {
            console.warn('[Apify] DB kayıt hatası:', dbErr.message);
        }
    }

    console.log(`[Apify] ✓ ${saved} VISUAL_TRENDS kaydedildi: ${keyword}`);
    return { saved, trends: enrichedTrends };
}

async function scrapePinterestTrendsAndSave(keyword, workspaceId, maxResults = 30) {
    const trends = await scrapePinterestTrends(keyword, maxResults);
    const { saved, trends: enriched } = await savePinterestTrendsToKnowledge(trends, workspaceId, keyword);
    return { trends: enriched, saved };
}

// ─── 5. Canlı Rakip Bağlamı (Audit için) ─────────────────────────────────────

async function fetchCompetitorContext(keywords = []) {
    const byKeyword = {};

    for (const kw of keywords.slice(0, 5)) {
        try {
            const products = await scrapeEtsyProducts(kw, 25);
            if (!products.length) continue;

            const prices = products.map(p => p.price).filter(p => p > 0);
            const avg    = v => Math.round(v.reduce((a, b) => a + b, 0) / v.length * 100) / 100;

            byKeyword[kw] = {
                avgPrice:    prices.length ? avg(prices) : 0,
                minPrice:    prices.length ? Math.min(...prices) : 0,
                maxPrice:    prices.length ? Math.max(...prices) : 0,
                topTitles:   products.slice(0, 5).map(p => p.title),
                topImages:   products.slice(0, 3).map(p => p.imageUrl).filter(Boolean),
                sampleCount: products.length,
            };
        } catch (err) {
            console.warn(`[Apify] Rakip tarama hatası "${kw}": ${err.message}`);
        }
    }

    const lines = ['RAKİP ÜRÜN VERİSİ (Canlı Etsy):'];
    for (const [kw, d] of Object.entries(byKeyword)) {
        lines.push(`  "${kw}" → Ort: $${d.avgPrice} | Min: $${d.minPrice} | Maks: $${d.maxPrice} (${d.sampleCount} ürün)`);
        lines.push(`    En çok satan başlıklar: ${d.topTitles.slice(0, 3).join(' / ')}`);
    }

    return { byKeyword, summary: lines.join('\n') };
}

// ─── 6. 2026 Trend Fetcher ────────────────────────────────────────────────────

async function fetch2026Trends(workspaceId) {
    console.log(`[Apify] 🗓️ 2026 trend taraması: ${TRENDS_2026.length} keyword`);
    const results = [];

    await prisma.workspace.upsert({
        where:  { id: workspaceId },
        update: {},
        create: { id: workspaceId, name: 'Default Workspace', slug: workspaceId },
    });

    for (const trend of TRENDS_2026) {
        try {
            const products = await scrapeEtsyProducts(trend.keyword, 20);

            if (!products.length) {
                results.push({ ...trend, productsFound: 0, saved: 0 });
                continue;
            }

            const prices   = products.map(p => p.price).filter(p => p > 0);
            const avgPrice = prices.length
                ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length * 100) / 100
                : 0;

            const topTitles = products.slice(0, 5).map(p => p.title).join('\n- ');
            const content   = `2026 Etsy Trend Raporu: "${trend.keyword}" (${trend.event})\n\n` +
                `Ortalama fiyat: $${avgPrice} | ${products.length} ürün analiz edildi.\n\n` +
                `Öne çıkan başlıklar:\n- ${topTitles}`;

            await prisma.corporateMemory.create({
                data: {
                    workspaceId,
                    type:     'STRATEGIC_RULE',
                    title:    `[2026 TREND] ${trend.event} — "${trend.keyword}"`,
                    content,
                    category: 'STRATEGY',
                    isActive: true,
                    tags:     ['2026', trend.priority.toLowerCase(), trend.event.split(' ')[0].toLowerCase()],
                    analysisResult: {
                        ruleCategory: '2026_TRENDS', domain: 'STRATEGY',
                        priority: trend.priority, event: trend.event, keyword: trend.keyword,
                        avgPrice, sampleCount: products.length,
                        topTitles: products.slice(0, 5).map(p => p.title),
                        extractedAt: new Date().toISOString(),
                    },
                },
            });

            results.push({ ...trend, productsFound: products.length, saved: 1 });
            console.log(`[Apify] ✓ 2026 trend kaydedildi: ${trend.event}`);
        } catch (err) {
            console.warn(`[Apify] 2026 trend hatası "${trend.keyword}": ${err.message}`);
            results.push({ ...trend, productsFound: 0, saved: 0, error: err.message });
        }
    }

    const savedCount = results.filter(r => r.saved).length;
    console.log(`[Apify] 🗓️ Tamamlandı: ${savedCount}/${TRENDS_2026.length} kaydedildi.`);
    return results;
}

module.exports = {
    scrapeEtsyProducts,
    scrapePinterestTrends,
    scrapePinterestTrendsAndSave,
    researchEtsyKeywords,
    savePinterestTrendsToKnowledge,
    fetchCompetitorContext,
    fetch2026Trends,
    TRENDS_2026,
    ApifyPaymentError,
    X402ConfigError,
};
