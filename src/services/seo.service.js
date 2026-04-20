/**
 * SEO Optimization Motor
 *
 * Bir WPI Action Card'ından Etsy için SEO paketi üretir:
 *   1. Rakip başlık + targetKeywords'ten Keyword Density Map çıkar
 *   2. Academy Brain'den SEO_TACTICS + RULES context alır
 *   3. Claude Haiku → 140-char title, 13 tags, conversion-focused description
 */

const { PrismaClient } = require('@prisma/client');
const anthropic        = require('../lib/anthropic');
const { getContextForAI } = require('./knowledge.service');

const prisma = new PrismaClient();

// ─── Keyword Density Map ────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'for', 'of', 'in', 'on', 'at', 'to',
    'with', 'by', 'as', 'is', 'it', 'be', 'are', 'was', 'were', 'been',
    'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'that', 'this', 'these', 'those', 'from',
    'up', 'down', 'out', 'about', 'into', 'i', 'my', 'your', 'our', 'their',
]);

function buildKeywordDensityMap(titles = [], extraKeywords = []) {
    const freq = {};

    const addWord = (w) => {
        if (w.length >= 3 && !STOP_WORDS.has(w)) {
            freq[w] = (freq[w] || 0) + 1;
        }
    };

    const tokenize = (text) =>
        text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

    titles.forEach(title => {
        const words = tokenize(title);
        words.forEach(addWord);
        // Bigram bonus — multi-word phrases are high-value Etsy tags
        for (let i = 0; i < words.length - 1; i++) {
            const w1 = words[i], w2 = words[i + 1];
            if (w1.length >= 3 && !STOP_WORDS.has(w1) && w2.length >= 3 && !STOP_WORDS.has(w2)) {
                const bigram = `${w1} ${w2}`;
                freq[bigram] = (freq[bigram] || 0) + 2;
            }
        }
    });

    extraKeywords.forEach(kw => tokenize(kw).forEach(addWord));

    return Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([kw, count]) => ({ kw, count }));
}

// ─── Claude Haiku SEO Call ──────────────────────────────────────────────────────

async function _callClaude({ keyword, product, actionCard, brainComparison, densityMap, academyContext }) {
    const topKeywords = densityMap.slice(0, 12).map(d => `"${d.kw}" (${d.count}x)`).join(', ');
    const targetKws   = (actionCard.targetKeywords || []).join(', ');
    const niche       = brainComparison?.niche || actionCard?.differentiationAngle || keyword;
    const designHint  = brainComparison?.designSuggestion || actionCard?.designSuggestion || '';
    const edge        = brainComparison?.competitiveEdge || '';
    const palette     = actionCard?.colorPalette || brainComparison?.colorPalette || '';

    const prompt = `Sen, Etsy POD mağazaları için uzman bir SEO içerik yazarısın.

ÜRÜN BİLGİSİ:
- Ana Keyword: "${keyword}"
- Niş: "${niche}"
- Rakip Başlığı: "${product.title}"
- Rakip Fiyatı: $${product.price}
- Tasarım İpucu: "${designHint}"
- Rekabetçi Avantaj: "${edge}"
- Renk Paleti: "${palette}"
- Önerilen Keywords: ${targetKws || '(yok)'}

ANAHTAR KELİME YOĞUNLUK HARİTASI (rakip analizinden):
${topKeywords || '(veri yok)'}

ACADEMY KURALLARI (SEO Taktikleri — BUNLARA AYKIRI HİÇBİR ŞEY YAZMA):
${academyContext || '(Academy henüz boş — Etsy best practices uygula)'}

GÖREV: Bu ürün için Etsy'de satışı maksimize edecek SEO paketi oluştur.

KURALLAR:
- BAŞLIK: Tam olarak 140 karakter (Etsy limiti), keyword-rich. İlk 40 karakterde en önemli keyword olmalı. | ile gruplar ayır. Marka adı yok.
- ETİKETLER: Tam olarak 13 adet, her biri max 20 karakter. Uzun kuyruklu, niyete yönelik kelimeler. Başlıkta geçenleri tekrarlama.
- AÇIKLAMA: 180-250 kelime. İlk cümlede ana keyword. Malzeme, kullanım, hediye okasyon, CTA içersin. Okunabilir paragraflar.

SADECE JSON döndür:
{
  "title": "<tam 140 karakter başlık>",
  "tags": ["<tag1>","<tag2>","<tag3>","<tag4>","<tag5>","<tag6>","<tag7>","<tag8>","<tag9>","<tag10>","<tag11>","<tag12>","<tag13>"],
  "description": "<tam açıklama metni>"
}`;

    const res  = await anthropic.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        messages:   [{ role: 'user', content: prompt }],
    });

    const raw   = res.content[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Claude SEO yanıtı JSON içermiyor');
    const parsed = JSON.parse(match[0]);

    // Validate
    if (!parsed.title || !Array.isArray(parsed.tags) || !parsed.description) {
        throw new Error('Claude SEO yanıtı eksik alan içeriyor');
    }
    // Ensure exactly 13 tags
    while (parsed.tags.length < 13) parsed.tags.push(keyword.split(' ')[0]);
    parsed.tags = parsed.tags.slice(0, 13).map(t => String(t).slice(0, 20));

    return parsed;
}

// ─── Main export ────────────────────────────────────────────────────────────────

/**
 * WPI Action Card ID'sinden Etsy SEO paketi üretir.
 *
 * @param {string} cardId      — CorporateMemory ID (WPI_WINNER)
 * @param {string} workspaceId
 * @returns {{ title, tags, description, keywordDensityMap }}
 */
async function generateSeoPackage(cardId, workspaceId) {
    const record = await prisma.corporateMemory.findFirst({
        where: { id: cardId, workspaceId, type: 'WPI_WINNER' },
    });
    if (!record) throw new Error('Action card bulunamadı');

    const { keyword, product, actionCard, brainComparison } = record.analysisResult || {};
    if (!keyword || !product) throw new Error('Action card verisi eksik');

    // Build keyword density map from competitor title + targetKeywords
    const competitorTitles = [product.title].filter(Boolean);
    const extraKws         = actionCard?.targetKeywords || [];
    const densityMap       = buildKeywordDensityMap(competitorTitles, extraKws);

    // Academy context — SEO_TACTICS + RULES categories for highest relevance
    const academyContext = await getContextForAI(
        workspaceId,
        `etsy seo ${keyword} ${product.title}`,
        { maxChars: 800, topK: 5 }
    );

    const seoData = await _callClaude({
        keyword,
        product,
        actionCard: actionCard || {},
        brainComparison: brainComparison || {},
        densityMap,
        academyContext,
    });

    console.log(`[SEO Motor] ✅ "${keyword}" için SEO paketi oluşturuldu — title: ${seoData.title.length} char`);

    return {
        title:            seoData.title,
        tags:             seoData.tags,
        description:      seoData.description,
        keywordDensityMap: densityMap,
    };
}

module.exports = { generateSeoPackage, buildKeywordDensityMap };
