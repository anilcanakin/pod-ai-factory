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
 * @param {string} workspaceId
 * @param {string} [query] - Keyword/niche for semantic search (opsiyonel)
 */
async function getSeoContext(workspaceId, query = null) {
    const [brainResult, seoResult, perfResult] = await Promise.allSettled([
        query
            ? getVectorContext(query, workspaceId, 6, 0.35)
            : getRelevantContext(workspaceId, 'seo'),
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
 * @param {string} workspaceId
 * @param {string} [query] - Keyword/niche for semantic search (opsiyonel)
 */
async function getFactoryContext(workspaceId, query = null) {
    const [brainResult, perfResult] = await Promise.allSettled([
        query
            ? getVectorContext(query, workspaceId, 6, 0.35)
            : getRelevantContext(workspaceId, 'factory'),
        getPerformanceContext(workspaceId)
    ]);

    const brain = brainResult.status === 'fulfilled' ? brainResult.value : '';
    const perf  = perfResult.status  === 'fulfilled' ? perfResult.value  : '';

    return [brain, perf].filter(Boolean).join('\n\n---\n\n');
}

/**
 * Get context for idea generation.
 * @param {string} workspaceId
 * @param {string} [query] - Niche for semantic search (opsiyonel)
 */
async function getIdeasContext(workspaceId, query = null) {
    if (query) return getVectorContext(query, workspaceId, 6, 0.35);
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
 * pgvector ile DB tarafında cosine similarity hesabı yapar.
 * Tüm kayıtları belleğe çekmek yerine DB'de sıralar, sadece top-K döner.
 * pgvector mevcut değilse JS cosine fallback'e geçer.
 */
async function _pgVectorSearch(queryVec, workspaceId, matchCount, threshold) {
    // vecStr sadece sayılar ve virgülden oluşur — SQL injection riski yok
    const vecStr = `[${queryVec.map(n => n.toFixed(8)).join(',')}]`;
    const wsFilter = workspaceId ? `AND "workspaceId" = '${workspaceId.replace(/'/g, "''")}'` : '';
    const limit = parseInt(matchCount, 10);
    const thresholdNum = parseFloat(threshold);

    const rows = await prisma.$queryRawUnsafe(`
        SELECT id, content, title, category, "sourceType",
               1 - ((("vectorEmbedding")::text::vector(1536)) <=> '${vecStr}'::vector(1536)) AS similarity
        FROM "CorporateMemory"
        WHERE "isActive" = true
          AND "vectorEmbedding" IS NOT NULL
          ${wsFilter}
          AND 1 - ((("vectorEmbedding")::text::vector(1536)) <=> '${vecStr}'::vector(1536)) >= ${thresholdNum}
        ORDER BY (("vectorEmbedding")::text::vector(1536)) <=> '${vecStr}'::vector(1536)
        LIMIT ${limit}
    `);

    return rows;
}

function _cosineSim(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na  += a[i] * a[i];
        nb  += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
}

async function _jsCosineSearch(queryVec, workspaceId, matchCount, threshold) {
    const where = { isActive: true, vectorEmbedding: { not: null } };
    if (workspaceId) where.workspaceId = workspaceId;

    const records = await prisma.corporateMemory.findMany({
        where,
        select: { id: true, content: true, title: true, category: true, sourceType: true, vectorEmbedding: true },
    });

    return records
        .map(r => {
            const vec = Array.isArray(r.vectorEmbedding)
                ? r.vectorEmbedding
                : (typeof r.vectorEmbedding === 'string' ? JSON.parse(r.vectorEmbedding) : null);
            if (!vec) return null;
            return { ...r, similarity: _cosineSim(queryVec, vec) };
        })
        .filter(r => r && r.similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, matchCount);
}

/**
 * RAG: CorporateMemory tablosunu vektör benzerliği ile sorgular.
 * pgvector aktifse DB'de hesaplar (hızlı), yoksa JS cosine fallback kullanır.
 *
 * @param {string} query       - Niş veya anahtar kelime (örn: 'boxing tee gift for dad')
 * @param {string} workspaceId - Workspace ID (opsiyonel — null ise tüm workspace)
 * @param {number} matchCount  - Döndürülecek maksimum chunk sayısı
 * @param {number} threshold   - Minimum cosine benzerlik skoru (0–1)
 * @returns {Promise<string>}  - Prompt'a enjekte edilecek bağlam metni
 */
async function getVectorContext(query, workspaceId = null, matchCount = 5, threshold = 0.45) {
    if (!query || !process.env.OPENAI_API_KEY) return '';

    try {
        const embeddingRes = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: query.slice(0, 500),
        });
        const queryVec = embeddingRes.data[0].embedding;

        let scored;
        try {
            scored = await _pgVectorSearch(queryVec, workspaceId, matchCount, threshold);
            console.log(`[VectorContext] pgvector: ${scored.length} chunk (query: "${query.slice(0, 40)}...")`);
        } catch (pgErr) {
            // pgvector extension yüklü değilse JS cosine fallback
            console.warn(`[VectorContext] pgvector kullanılamıyor, JS fallback: ${pgErr.message.slice(0, 80)}`);
            scored = await _jsCosineSearch(queryVec, workspaceId, matchCount, threshold);
            console.log(`[VectorContext] JS cosine: ${scored.length} chunk`);
        }

        if (!scored || scored.length === 0) return '';

        return scored
            .map((r, i) => {
                const label = r.sourceType === 'Expert' ? '⭐ EXPERT' : (r.sourceType || 'KNOWLEDGE');
                return `[Kaynak ${i + 1} | ${label} | ${r.category}] ${r.title}:\n${String(r.content).slice(0, 600)}`;
            })
            .join('\n\n---\n\n');

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
