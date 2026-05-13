const prisma = require('../lib/prisma');
const { getKnowledge } = require('./seo-knowledge.service');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CATEGORY_MAP = {
    seo:     ['seo_tips', 'etsy_algorithm', 'pod_apparel'],
    factory: ['pod_apparel', 'niche_research', 'general_etsy'],
    ideas:   ['niche_research', 'etsy_algorithm', 'general_etsy'],
    general: ['pod_apparel', 'seo_tips', 'etsy_algorithm', 'niche_research', 'general_etsy']
};

/**
 * Get relevant knowledge context for a given topic/category.
 * Used to inject into AI prompts automatically.
 */
async function getRelevantContext(workspaceId, topic = 'general') {
    try {
        const categories = CATEGORY_MAP[topic] || CATEGORY_MAP.general;

        // Fetch memories, prioritizing 'Expert' sourceType
        const memories = await prisma.corporateMemory.findMany({
            where: {
                workspaceId,
                isActive: true,
                category: { in: categories }
            },
            orderBy: [
                { sourceType: 'desc' }, // 'Expert' usually comes before others if sorted correctly, or we use explicit logic
                { createdAt: 'desc' }
            ],
            take: 5,
            select: { analysisResult: true, category: true, title: true, sourceType: true }
        });

        if (memories.length === 0) return '';

        const contextParts = memories.map(m => {
            const ar = m.analysisResult;
            const content = ar?.synthesis
                || (ar?.actionableRules?.map(r => `IF ${r.condition} THEN ${r.action}`).join('\n'))
                || '';
            if (!content) return null;
            
            const sourceLabel = m.sourceType === 'Expert' ? '⭐ EXPERT ADVICE ⭐' : m.sourceType?.toUpperCase();
            return `[${sourceLabel}] [${(m.category || 'KNOWLEDGE').toUpperCase()}] ${m.title || ''}:\n${content.slice(0, 700)}`;
        }).filter(Boolean);

        return contextParts.join('\n\n---\n\n');

    } catch (err) {
        console.warn('[Knowledge Context] Failed:', err.message);
        return '';
    }
}

/**
 * Get full system context for SEO generation.
 * Combines seoKnowledgeBase + relevant brain memories.
 */
async function getSeoContext(workspaceId) {
    const [brainResult, seoResult, perfResult] = await Promise.allSettled([
        getRelevantContext(workspaceId, 'seo'),
        getKnowledge(workspaceId),
        getPerformanceContext(workspaceId)
    ]);

    const brain = brainResult.status === 'fulfilled' ? brainResult.value : '';
    const seo   = seoResult.status   === 'fulfilled' ? seoResult.value   : '';
    const perf  = perfResult.status  === 'fulfilled' ? perfResult.value  : '';

    return [seo, brain ? `## ADDITIONAL KNOWLEDGE FROM YOUR TRAINING MATERIALS:\n${brain}` : '', perf]
        .filter(Boolean).join('\n\n');
}

/**
 * Top-performing design verilerini Factory/SEO promptlarına enjekte etmek için özet döner.
 * ProductPerformance tablosundaki WINNER ve yüksek-scorlu tasarımları kullanır.
 */
async function getPerformanceContext(workspaceId) {
    try {
        const performers = await prisma.productPerformance.findMany({
            where: {
                image: { job: { workspaceId } },
                OR: [{ flag: 'WINNER' }, { score: { gte: 50 } }]
            },
            orderBy: { score: 'desc' },
            take: 5,
            include: {
                image: {
                    include: {
                        seoData: true,
                        job: { select: { keyword: true, niche: true, style: true } }
                    }
                }
            }
        });

        if (!performers.length) return '';

        const lines = performers.map(p => {
            const job   = p.image?.job;
            const seo   = p.image?.seoData;
            const ctr   = p.impressions > 0 ? ((p.visits / p.impressions) * 100).toFixed(1) : '0.0';
            const niche = [job?.niche, job?.keyword, job?.style].filter(Boolean).join(' / ') || 'Bilinmiyor';
            const title = seo?.title ? `"${seo.title.slice(0, 70)}"` : '';
            return `• ${niche} — Score: ${p.score}, CTR: ${ctr}%, Orders: ${p.orders}${title ? `\n  Title: ${title}` : ''}`;
        });

        return `## EN İYİ PERFORMANS GÖSTEREN TASARIMLAR (Gerçek Etsy Verisi):\nBu niş/stil kombinasyonları en yüksek tıklama ve sipariş oranlarını sağladı — benzer tasarımları önceliklendir:\n${lines.join('\n')}`;
    } catch (err) {
        console.warn('[PerformanceContext] Failed:', err.message);
        return '';
    }
}

/**
 * Get context for Factory prompt/variation generation.
 */
async function getFactoryContext(workspaceId) {
    const [brainResult, perfResult] = await Promise.allSettled([
        getRelevantContext(workspaceId, 'factory'),
        getPerformanceContext(workspaceId)
    ]);

    const brain = brainResult.status === 'fulfilled' ? brainResult.value : '';
    const perf  = perfResult.status  === 'fulfilled' ? perfResult.value  : '';

    return [brain, perf].filter(Boolean).join('\n\n---\n\n');
}

/**
 * Get context for idea generation.
 */
async function getIdeasContext(workspaceId) {
    return getRelevantContext(workspaceId, 'ideas');
}

/**
 * Get a lightweight summary of the knowledge base state.
 * Used for the Overview dashboard stat card.
 */
async function getKnowledgeSummary(workspaceId) {
    const [count, latest] = await Promise.all([
        prisma.corporateMemory.count({
            where: { workspaceId, isActive: true }
        }),
        prisma.corporateMemory.findFirst({
            where: { workspaceId, isActive: true },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true, category: true }
        })
    ]);

    return {
        totalEntries: count,
        lastUpdated: latest?.createdAt || null,
        lastCategory: latest?.category || null
    };
}

/**
 * RAG: CorporateMemory tablosunu pgvector cosine similarity ile sorgular.
 * Yerel Postgres 18 + pgvector kullanır — Supabase RPC gerekmez.
 *
 * @param {string} query       - Niş veya anahtar kelime (örn: 'boxing tee gift for dad')
 * @param {number} matchCount  - Döndürülecek maksimum chunk sayısı
 * @param {number} threshold   - Minimum cosine benzerlik skoru (0–1)
 * @returns {Promise<string>}  - Prompt'a enjekte edilecek bağlam metni
 */
async function getVectorContext(query, matchCount = 5, threshold = 0.7) {
    if (!query || !process.env.OPENAI_API_KEY) return '';

    try {
        // 1. Sorgu metnini vektöre dönüştür
        const embeddingRes = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: query,
        });
        const queryEmbedding = embeddingRes.data[0].embedding;
        const vecLiteral = JSON.stringify(queryEmbedding);

        // 2. Yerel pgvector ile cosine similarity sorgusu
        // vectorEmbedding JSONB::text::vector cast — extension index bunu yakalar.
        const rows = await prisma.$queryRaw`
            SELECT id, content, title, category,
                   1 - ("vectorEmbedding"::text::vector <=> ${vecLiteral}::vector) AS similarity
            FROM "CorporateMemory"
            WHERE "vectorEmbedding" IS NOT NULL
              AND "isActive" = true
            ORDER BY "vectorEmbedding"::text::vector <=> ${vecLiteral}::vector
            LIMIT ${matchCount}
        `;

        // 3. Eşik altını filtrele
        const matches = rows.filter(r => parseFloat(r.similarity) >= threshold);
        if (matches.length === 0) return '';

        // 4. İçerikleri tek bir bağlam bloğu hâline getir
        const context = matches
            .map((row, i) => `[Kaynak ${i + 1}] (${row.category}) ${row.title}:\n${String(row.content).slice(0, 600)}`)
            .join('\n\n');

        console.log(`[VectorContext] ${matches.length} chunk bulundu — yerel pgvector (query: "${query.slice(0, 40)}...")`);
        return context;

    } catch (err) {
        console.warn('[VectorContext] Hata (graceful fallback):', err.message);
        return '';
    }
}

module.exports = {
    getRelevantContext,
    getSeoContext,
    getFactoryContext,
    getIdeasContext,
    getKnowledgeSummary,
    getVectorContext,
    getPerformanceContext,
};
