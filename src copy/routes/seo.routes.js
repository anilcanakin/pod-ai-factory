const express = require('express');
const router = express.Router();
const { expandKeywords, getGoogleTrends } = require('../services/keyword-research.service');
const { getKnowledge } = require('../services/seo-knowledge.service');

function extractSeedKeywords(description, focusKeyword) {
    const seeds = [];
    if (focusKeyword) seeds.push(focusKeyword);

    if (description) {
        const styleTerms = description.match(
            /\b(vintage|retro|minimalist|grunge|floral|botanical|patriotic|american|eagle|wolf|skull|bear|lion|tiger|mountain|nature|funny|cute|cool|aesthetic|street|urban)\b/gi
        ) || [];

        seeds.push(...styleTerms.map(s => `${s.toLowerCase()} shirt`));
        seeds.push(...styleTerms.map(s => `${s.toLowerCase()} t-shirt`));

        if (seeds.length < 3) {
            seeds.push('graphic tee gift', 'custom shirt design', 'unique t-shirt');
        }
    }

    return [...new Set(seeds)].slice(0, 5);
}

// POST /api/seo/generate
router.post('/generate', async (req, res) => {
    try {
        const { imageUrl, keyword = '' } = req.body;
        if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' });

        const workspaceId = req.workspaceId;
        if (!workspaceId) return res.status(401).json({ error: 'Authentication required.' });

        const visionService = require('../services/vision.service');
        const Anthropic = require('@anthropic-ai/sdk');

        // Step 1: Analyze image with vision
        let imageDescription = '';
        try {
            let base64Data = imageUrl;
            let mimeType = 'image/jpeg';
            if (imageUrl.startsWith('data:')) {
                const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
                if (matches) { mimeType = matches[1]; base64Data = matches[2]; }
            }
            const visionResult = await visionService.analyzeImage(base64Data, mimeType);
            imageDescription = visionResult.prompt || '';
        } catch (e) {
            console.warn('[SEO] Vision failed, using keyword only:', e.message);
        }

        // Step 2: Keyword research + knowledge base (parallel, graceful fallback)
        const seedKeywords = extractSeedKeywords(imageDescription, keyword);

        const [expandedResult, trendsResult, knowledgeBase] = await Promise.allSettled([
            expandKeywords(seedKeywords),
            getGoogleTrends(seedKeywords),
            getKnowledge(workspaceId)
        ]);

        const etsyKeywords = expandedResult.status === 'fulfilled'
            ? expandedResult.value
            : seedKeywords;
        const trendData = trendsResult.status === 'fulfilled'
            ? trendsResult.value
            : { trending: [] };
        const knowledge = knowledgeBase.status === 'fulfilled'
            ? knowledgeBase.value
            : '';

        const keywordContext = `
Real Etsy search suggestions (what buyers actually type):
${etsyKeywords.slice(0, 20).map((k, i) => `${i + 1}. "${k}"`).join('\n')}

${trendData.trending.length > 0 ? `Trending related topics: ${trendData.trending.join(', ')}` : ''}

${keyword ? `Seller's focus keyword: "${keyword}"` : ''}
`.trim();

        // Step 3: Generate SEO with Claude + knowledge base
        const client = new Anthropic();

        const systemPrompt = `${knowledge}

## YOUR TASK
Generate optimized Etsy listing content using the algorithm knowledge above.
Return ONLY valid JSON, no markdown, no explanation:
{
  "title": "...",
  "description": "...",
  "tags": ["tag1", ..., "tag13"],
  "topKeywords": ["keyword1", "keyword2", "keyword3"]
}`;

        const userPrompt = `Create an optimized Etsy listing for this POD t-shirt design.

Design: ${imageDescription}

${keywordContext}

Generate SEO content using the real Etsy search data above.
The tags MUST include keywords from the "Real Etsy search suggestions" list.`;

        const response = await client.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 1500,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }]
        });

        const raw = response.content[0].text.trim();
        const clean = raw.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);

        if (!parsed.title || !parsed.description || !Array.isArray(parsed.tags)) {
            return res.status(500).json({ error: 'Invalid SEO response format' });
        }

        parsed.title = parsed.title.slice(0, 140);
        parsed.tags = parsed.tags.slice(0, 13);

        res.json({
            title: parsed.title,
            description: parsed.description,
            tags: parsed.tags,
            charCount: parsed.title.length,
            topKeywords: parsed.topKeywords || [],
            etsySuggestions: etsyKeywords.slice(0, 10),
            dataSource: 'etsy-autocomplete + google-trends'
        });

    } catch (err) {
        console.error('[SEO Generate]', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
