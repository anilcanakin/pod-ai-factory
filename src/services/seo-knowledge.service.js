const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const anthropic = require('../lib/anthropic');

const DEFAULT_KNOWLEDGE = `## ETSY 2026 SEO ALGORITHM KNOWLEDGE

You are an expert Etsy SEO specialist with access to real Etsy search data.
You have been provided with REAL keywords that Etsy buyers are actually searching for right now.
Use these keywords strategically — they represent actual buyer intent and search behavior.

### TITLE RULES
- Exactly 140 characters max
- Start with the highest-volume keyword from the provided Etsy suggestions
- Use | to separate phrase groups (e.g. "Eagle Shirt | Gift for Dad | Patriotic Tee")
- No filler adjectives like "beautiful", "amazing", "stunning"
- Most important keyword must be in the first 40 characters (Etsy truncates in search)
- Include at least one gift occasion phrase

### TAG RULES
- Exactly 13 tags, each max 20 characters
- Use the provided real Etsy autocomplete suggestions as tags whenever possible — proven search terms
- Prioritize multi-word long-tail phrases over single words (converts better)
- Diverse coverage: product type, style, material, recipient, occasion, use case
- Avoid repeating exact words already in the title
- Each tag is a separate search query — treat them independently

### DESCRIPTION RULES
- 150-250 words total
- First sentence must contain the main keyword naturally
- Naturally weave in 3-5 of the provided keywords in the first paragraph
- Include: materials, use case, gift occasions, care instructions
- Use line breaks for readability
- End with a call to action

### POD T-SHIRT SPECIFIC TIPS
- "Gift for [person]" tags dramatically outperform generic style tags
- Buyers search by occasion: "birthday gift", "christmas gift", "fathers day gift"
- Include the print subject in the title AND tags: "eagle shirt" not just "graphic tee"
- "Unisex" and size range mentions improve conversion
- Screen print quality / DTG print callouts build trust

### BUYER INTENT FOCUS
- "gift for dad" beats "men's shirt"
- "vintage eagle tshirt" beats "eagle" alone
- Long-tail = lower competition + higher intent = better conversion rate`;

/**
 * Workspace için aktif knowledge base'i getir
 */
async function getKnowledge(workspaceId) {
    try {
        const kb = await prisma.seoKnowledgeBase.findFirst({
            where: { workspaceId, isActive: true },
            orderBy: { updatedAt: 'desc' }
        });
        return kb?.content || DEFAULT_KNOWLEDGE;
    } catch {
        return DEFAULT_KNOWLEDGE;
    }
}

/**
 * Otomatik güncelleme — Claude ile güncel Etsy SEO bilgisi oluştur
 */
async function autoUpdateKnowledge(workspaceId) {
    console.log('[SEO Knowledge] Starting auto-update...');

    const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 2000,
        messages: [{
            role: 'user',
            content: `You are an Etsy SEO expert. Based on your training data, provide a comprehensive, up-to-date summary of Etsy's current search algorithm and SEO best practices for 2026. Focus on:

1. How Etsy's ranking algorithm works (query matching + ranking factors)
2. Title optimization rules (character limits, keyword placement, NLP changes)
3. Tag strategy (all 13 tags, what to avoid, multi-word phrases)
4. Description best practices (first paragraph importance, structure)
5. POD (Print-on-Demand) t-shirt specific tips
6. What's changed recently / what to avoid

Format as a structured knowledge base that an AI SEO assistant would use.
Be specific, actionable, and current.`
        }]
    });

    const newContent = response.content[0].text;

    await prisma.seoKnowledgeBase.updateMany({
        where: { workspaceId, isActive: true },
        data: { isActive: false }
    });

    const kb = await prisma.seoKnowledgeBase.create({
        data: {
            workspaceId,
            content: newContent,
            source: 'auto',
            isActive: true
        }
    });

    console.log('[SEO Knowledge] Auto-update complete:', kb.id);
    return kb;
}

/**
 * Manuel güncelleme
 */
async function manualUpdateKnowledge(workspaceId, content) {
    await prisma.seoKnowledgeBase.updateMany({
        where: { workspaceId, isActive: true },
        data: { isActive: false }
    });

    return prisma.seoKnowledgeBase.create({
        data: {
            workspaceId,
            content,
            source: 'manual',
            isActive: true
        }
    });
}

/**
 * Knowledge base geçmişini getir
 */
async function getHistory(workspaceId) {
    return prisma.seoKnowledgeBase.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
            id: true,
            source: true,
            isActive: true,
            createdAt: true,
            updatedAt: true
        }
    });
}

/**
 * Belirli bir versiyonu aktif yap (rollback)
 */
async function activateVersion(workspaceId, id) {
    await prisma.seoKnowledgeBase.updateMany({
        where: { workspaceId, isActive: true },
        data: { isActive: false }
    });

    return prisma.seoKnowledgeBase.update({
        where: { id },
        data: { isActive: true }
    });
}

module.exports = {
    getKnowledge,
    autoUpdateKnowledge,
    manualUpdateKnowledge,
    getHistory,
    activateVersion
};
