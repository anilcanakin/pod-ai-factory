const prisma = require('../lib/prisma');
const { getKnowledge } = require('./seo-knowledge.service');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
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
    const [brainResult, seoResult] = await Promise.allSettled([
        getRelevantContext(workspaceId, 'seo'),
        getKnowledge(workspaceId)
    ]);

    const brain = brainResult.status === 'fulfilled' ? brainResult.value : '';
    const seo   = seoResult.status   === 'fulfilled' ? seoResult.value   : '';

    if (!brain && !seo) return '';
    if (!brain) return seo;

    return `${seo}\n\n## ADDITIONAL KNOWLEDGE FROM YOUR TRAINING MATERIALS:\n${brain}`;
}

/**
 * Get context for Factory prompt/variation generation.
 */
async function getFactoryContext(workspaceId) {
    return getRelevantContext(workspaceId, 'factory');
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
 * RAG: etsy_knowledge tablosunu embedding ile sorgula (match_knowledge RPC).
 * Kullanıcının girdiği niş/anahtar kelimeyle anlamsal olarak en alakalı
 * 5 içeriği döndürür. Supabase'de match_knowledge fonksiyonu yoksa boş string döner.
 *
 * @param {string} query - Niş veya anahtar kelime (örn: 'boxing tee gift for dad')
 * @param {number} matchCount - Döndürülecek maksimum chunk sayısı
 * @param {number} threshold - Minimum benzerlik skoru (0-1)
 * @returns {Promise<string>} - Prompt'a enjekte edilecek bağlam metni
 */
async function getVectorContext(query, matchCount = 5, threshold = 0.7) {
    if (!query || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return '';
    if (!process.env.OPENAI_API_KEY) return '';

    try {
        // 1. Sorgu metnini vektöre dönüştür
        const embeddingRes = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: query,
        });
        const queryEmbedding = embeddingRes.data[0].embedding;

        // 2. Supabase match_knowledge RPC ile en yakın chunk'ları çek
        const { data, error } = await supabase.rpc('match_knowledge', {
            query_embedding: queryEmbedding,
            match_threshold: threshold,
            match_count: matchCount,
        });

        if (error) {
            console.warn('[VectorContext] RPC error:', error.message);
            return '';
        }
        if (!data || data.length === 0) return '';

        // 3. İçerikleri tek bir bağlam bloğu hâline getir
        const context = data
            .map((row, i) => `[Kaynak ${i + 1}] ${row.content}`)
            .join('\n\n');

        console.log(`[VectorContext] ${data.length} chunk bulundu (query: "${query.slice(0, 40)}...")`);
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
};
