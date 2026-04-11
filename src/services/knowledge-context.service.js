const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { getKnowledge } = require('./seo-knowledge.service');

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

        const memories = await prisma.corporateMemory.findMany({
            where: {
                workspaceId,
                isActive: true,
                category: { in: categories }
            },
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: { analysisResult: true, category: true, title: true }
        });

        if (memories.length === 0) return '';

        const contextParts = memories.map(m => {
            const ar = m.analysisResult;
            const content = ar?.synthesis
                || (ar?.actionableRules?.map(r => `IF ${r.condition} THEN ${r.action}`).join('\n'))
                || '';
            if (!content) return null;
            return `[${(m.category || 'KNOWLEDGE').toUpperCase()}] ${m.title || ''}:\n${content.slice(0, 500)}`;
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

module.exports = {
    getRelevantContext,
    getSeoContext,
    getFactoryContext,
    getIdeasContext,
    getKnowledgeSummary
};
