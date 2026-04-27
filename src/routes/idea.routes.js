const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ 
    dest: 'assets/uploads/',
    limits: { fileSize: 1000 * 1024 * 1024 } // 1GB (Bulk CSV ve büyük assetler için)
});
const csv = require('csv-parser');
const fs = require('fs');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { assetQueue } = require('../queues/index');

const riskService = require('../services/risk.service');
const { VISION_SCHEMA } = require('../services/vision.service');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const prisma = require('../lib/prisma');

// Canonical POD style list — fallback when VISION_SCHEMA.style has no .enum
const FALLBACK_STYLE_OPTIONS = [
    'vintage distressed', 'minimalist line art', 'neon cyberpunk',
    'watercolor soft', 'bold retro', 'grunge punk', 'kawaii cute',
    'art deco', 'other_pod_style'
];

function getStyleOptions() {
    return VISION_SCHEMA.json_schema?.schema?.properties?.style?.enum ?? FALLBACK_STYLE_OPTIONS;
}

// POST /api/ideas/generate
// Accepts a CSV of top EverBee/eRank keywords and generates exactly 20 ideas
router.post('/generate', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Upload a CSV file containing keywords." });

        const keywords = [];

        // Parse CSV looking for any columns indicating Keyword or Tags
        await new Promise((resolve, reject) => {
            fs.createReadStream(req.file.path)
                .pipe(csv())
                .on('data', (data) => {
                    // Generic mapping: try to find 'Keyword' or 'Tags' in the headers
                    const key = Object.keys(data).find(k => k.toLowerCase().includes('keyword') || k.toLowerCase().includes('tag'));
                    if (key && data[key] && !riskService.isSafe(data[key]) === false) {
                        keywords.push(data[key]);
                    }
                })
                .on('end', () => resolve())
                .on('error', reject);
        });

        // Limit keyword input sample to OpenAI to save tokens
        const sampleKeywords = (keywords || []).slice(0, 50).join(', ');
        const styleOptions = getStyleOptions();

        // Let's ask OpenAI to generate exactly 20 Ideas
        const prompt = `You are a top-tier POD (Print-On-Demand) designer. Using these trendy keywords: [${sampleKeywords}], generate exactly 20 unique design ideas. 
DO NOT INCLUDE any trademarks.
Output strict JSON format ONLY:
[
  {
     "niche": "e.g. coffee_lovers",
     "mainKeyword": "e.g. funny coffee shirt",
     "persona": "e.g. millennial mom who needs caffeine",
     "hook": "e.g. 'Coffee: My survival juice'",
     "iconFamily": ["coffee_cup", "stars"],
     "styleEnum": "ONE OF: ${styleOptions.join(', ')}"
  }
]
No markdown wrapping. No explanations. Just the JSON array starting with [ and ending with ].`;

        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo",
            messages: [{ role: "system", content: prompt }],
            temperature: 0.7,
        });

        const jsonStr = response.choices[0].message.content.trim();
        let ideas;
        try {
            ideas = JSON.parse(jsonStr);
        } catch (e) {
            // Strip markdown formatting if AI disobeyed
            let cleaned = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
            ideas = JSON.parse(cleaned);
        }

        // Validate Risk Filter & Enforce 20 count
        const validIdeas = [];
        for (const idea of ideas) {
            if (idea && typeof idea === 'object' && riskService.isIdeaSafe(idea)) {
                // Push to DB
                const created = await prisma.idea.create({
                    data: {
                        niche: idea.niche || 'general',
                        mainKeyword: idea.mainKeyword || '',
                        persona: idea.persona || '',
                        hook: idea.hook || '',
                        iconFamily: Array.isArray(idea.iconFamily) ? idea.iconFamily : [],
                        styleEnum: idea.styleEnum && styleOptions.includes(idea.styleEnum) ? idea.styleEnum : 'other_pod_style',
                        status: 'PENDING'
                    }
                });
                validIdeas.push(created);
            }
        }

        res.json({ message: `Successfully generated and saved ${validIdeas.length} safe ideas.`, ideas: validIdeas });

    } catch (err) {
        console.error('Ideas Generate error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/ideas
router.get('/', async (req, res) => {
    try {
        const ideas = await prisma.idea.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json(ideas);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/ideas/:id/status
router.post('/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // 'APPROVED' or 'REJECTED'

        if (status !== 'APPROVED' && status !== 'REJECTED') {
            return res.status(400).json({ error: "Invalid status." });
        }

        const updated = await prisma.idea.update({
            where: { id },
            data: { status }
        });

        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/ideas/:id/factory
router.post('/:id/factory', async (req, res) => {
    console.log('[Ideas/Factory] İstek alındı. ideaId:', req.params.id, '| workspaceId:', req.workspaceId);
    try {
        const { id } = req.params;
        const { modelTier } = req.body; // optional: 'fast' | 'quality' | 'text' | 'vector'

        const idea = await prisma.idea.findUnique({ where: { id } });
        if (!idea) return res.status(404).json({ error: "Idea not found." });

        if (idea.status !== 'APPROVED') {
            return res.status(400).json({ error: "Only APPROVED ideas can be sent to factory." });
        }

        // 1. Create DesignJob
        const jobIdRef = `IDEA-${idea.id.substring(0, 8).toUpperCase()}`;
        const job = await prisma.designJob.create({
            data: {
                originalImage: jobIdRef,
                status: 'PROCESSING',
                workspaceId: req.workspaceId || null,
                niche: idea.niche,
                style: idea.styleEnum,
                keyword: idea.mainKeyword,
            }
        });
        console.log('[Ideas/Factory] DesignJob oluşturuldu:', job.id);

        // 2. Synthesize Vision Data
        const synthesizedVision = {
            style: idea.styleEnum,
            niche_guess: idea.niche,
            icon_family: Array.isArray(idea.iconFamily) ? idea.iconFamily : [],
            composition: "centered_graphic",
            text_layout: "top_hook_bottom_hook",
            palette: ["brand_match"],
            raw_hook: idea.hook,
            raw_keyword: idea.mainKeyword
        };

        await prisma.visionAnalysis.create({
            data: {
                jobId: job.id,
                rawProviderResponse: JSON.stringify({ derivedFromIdea: true }),
                parsedVisionJson: synthesizedVision
            }
        });

        // 3. Image kaydını PENDING olarak oluştur, FAL ile gerçek görsel üretilecek
        const generationService = require('../services/generation.service');
        // Ideas default: 'quality' (Flux Dev). Caller can pass 'fast'/'text'/'vector' to override.
        const resolvedEngine = generationService.resolveModelId(modelTier || 'quality');

        const prompt = `${idea.styleEnum} style POD t-shirt graphic design, no background, transparent background: "${idea.hook}" — niche: ${idea.niche}, keyword: ${idea.mainKeyword}. Clean vector art, print-ready, no text unless part of hook.`;
        const image = await prisma.image.create({
            data: {
                jobId: job.id,
                variantType: 'idea_generated',
                promptUsed: prompt,
                engine: resolvedEngine,
                imageUrl: 'PENDING',
                status: 'GENERATED',
                isApproved: false,
                cost: 0,
            }
        });
        console.log('[Ideas/Factory] Image kaydı oluşturuldu:', image.id);

        // 4. FAL ile gerçek görsel üret (arka planda — response'u bloklamıyor)
        generationService.runGeneration(job.id, 'fal', 1, 'square_hd')
            .then(() => console.log('[Ideas/Factory] FAL üretimi tamamlandı. jobId:', job.id))
            .catch(async (err) => {
                console.error('[Ideas/Factory] FAL üretim hatası:', err.message);
                await prisma.image.updateMany({
                    where: { jobId: job.id, status: 'GENERATED' },
                    data: { status: 'FAILED' }
                });
                await prisma.designJob.update({
                    where: { id: job.id },
                    data: { status: 'FAILED' }
                });
            });

        // 5. Mark Idea as factory sent
        await prisma.idea.update({
            where: { id },
            data: { status: 'FACTORY_SENT' }
        });

        res.json({ message: "Idea forwarded to Factory successfully.", jobId: job.id, imageId: image.id, visionData: synthesizedVision });

    } catch (err) {
        console.error('[Ideas/Factory] HATA:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/ideas/generate-bulk
// Generates 5 ideas from a niche keyword using Claude Haiku
router.post('/generate-bulk', async (req, res) => {
    try {
        const { niche } = req.body;
        if (!niche || typeof niche !== 'string' || !niche.trim()) {
            return res.status(400).json({ error: 'niche is required' });
        }

        const styleOptions = getStyleOptions();

        const { getIdeasContext } = require('../services/knowledge-context.service');
        const ideasContext = await getIdeasContext(req.workspaceId || 'default-workspace');

        const systemPrompt = `You are a top-tier POD (Print-On-Demand) designer and Etsy market expert.${ideasContext ? `\n\nYOUR BUSINESS KNOWLEDGE:\n${ideasContext}` : ''}
Generate product ideas based on trends and the user's specific business knowledge.`;

        const message = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            system: systemPrompt,
            messages: [{
                role: 'user',
                content: `Generate exactly 5 unique design ideas for the niche: "${niche.trim()}".
DO NOT include any trademarks or copyrighted characters.
Output strict JSON array ONLY (no markdown, no explanation):
[
  {
    "niche": "snake_case_niche",
    "mainKeyword": "buyer search phrase",
    "persona": "target buyer description",
    "hook": "catchy text for the design",
    "iconFamily": ["icon1", "icon2"],
    "styleEnum": "ONE OF: ${styleOptions.join(', ')}"
  }
]`
            }]
        });

        const jsonStr = message.content[0].text.trim();
        let ideas;
        try {
            ideas = JSON.parse(jsonStr);
        } catch {
            const cleaned = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
            ideas = JSON.parse(cleaned);
        }

        const savedIdeas = [];
        for (const idea of ideas) {
            if (idea && typeof idea === 'object' && riskService.isIdeaSafe(idea)) {
                const created = await prisma.idea.create({
                    data: {
                        niche: idea.niche || niche.trim(),
                        mainKeyword: idea.mainKeyword || '',
                        persona: idea.persona || '',
                        hook: idea.hook || '',
                        iconFamily: Array.isArray(idea.iconFamily) ? idea.iconFamily : [],
                        styleEnum: idea.styleEnum && styleOptions.includes(idea.styleEnum) ? idea.styleEnum : 'other_pod_style',
                        status: 'PENDING',
                    }
                });
                savedIdeas.push(created);
            }
        }

        res.json({ message: `Generated ${savedIdeas.length} ideas for "${niche}"`, ideas: savedIdeas });
    } catch (err) {
        console.error('Ideas generate-bulk error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ideas/:id/validate — Market Validation with Profitability Score
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/validate', async (req, res) => {
    try {
        const { id } = req.params;
        const workspaceId = req.workspaceId || 'default-workspace';

        const idea = await prisma.idea.findUnique({ where: { id } });
        if (!idea) return res.status(404).json({ error: 'Idea not found' });

        const { getFullIntelligence, formatMarketContext } = require('../services/market.service');
        const billingService = require('../services/billing.service');

        const keyword = idea.mainKeyword || idea.niche;
        console.log(`[Validate] Starting market validation for: "${keyword}"`);

        // ── Step 1: Gather intelligence from Apify (3 parallel agents) ──────────
        const intel = await getFullIntelligence(keyword);

        // ── Step 2: Score with Claude Haiku ──────────────────────────────────────
        const marketContext = formatMarketContext(intel);

        const systemPrompt = `You are an expert POD (Print-on-Demand) business analyst specializing in Etsy market evaluation.
You combine competitor intelligence, pricing data, trend signals, and visual aesthetic signals to score niche viability.
Always output ONLY valid compact JSON — no markdown, no explanation.`;

        const userPrompt = `Evaluate this Etsy POD niche for profitability.

NICHE DETAILS:
- Niche: "${idea.niche}"
- Main Keyword: "${keyword}"
- Design Hook: "${idea.hook}"
- Design Style: "${idea.styleEnum}"

MARKET INTELLIGENCE:
${marketContext || `No live market data available. Base scoring on keyword strength alone.`}

SCORING RUBRIC:
- 80-100 → Excellent: clear demand, manageable competition, good price point
- 60-79  → Good: solid opportunity, needs visual differentiation
- 40-59  → Moderate: competitive market, requires strong hook
- 20-39  → Challenging: oversaturated or thin margins
- 1-19   → Poor: avoid

Return ONLY this JSON shape:
{
  "score": <integer 1-100>,
  "scoreLabel": "<Excellent|Good|Moderate|Challenging|Poor>",
  "strengths": ["<max 3 items>"],
  "risks": ["<max 2 items>"],
  "recommendation": "<one actionable sentence>"
}`;

        const scoreResponse = await anthropic.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 600,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }]
        });

        if (scoreResponse.usage) {
            billingService.logUsage('anthropic', 'claude-haiku-4-5', scoreResponse.usage, workspaceId, {
                feature: 'market_validation',
                ideaId: id
            }).catch(() => {});
        }

        // ── Step 3: Parse scoring ─────────────────────────────────────────────────
        let scoring;
        try {
            const raw = scoreResponse.content[0].text.trim();
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            scoring = JSON.parse(jsonMatch[0]);
            // Clamp score
            scoring.score = Math.min(100, Math.max(1, Math.round(scoring.score)));
        } catch {
            // Rule-based fallback if Claude returns malformed JSON
            const competition = intel?.competitionLevel ?? 'Bilinmiyor';
            const base = { 'Düşük': 72, 'Orta': 55, 'Yüksek': 38, 'Çok Yüksek': 22, 'Bilinmiyor': 50 };
            scoring = {
                score: base[competition] ?? 50,
                scoreLabel: 'Moderate',
                strengths: ['Rule-based estimate'],
                risks: ['Claude scoring unavailable'],
                recommendation: 'Run again for AI scoring.'
            };
        }

        // ── Step 4: Persist on Idea record ────────────────────────────────────────
        const marketData = {
            intel,
            scoring,
            validatedAt: new Date().toISOString(),
            keyword
        };

        const updated = await prisma.idea.update({
            where: { id },
            data: { marketScore: scoring.score, marketData }
        });

        console.log(`[Validate] ✅ "${keyword}" → Score: ${scoring.score} (${scoring.scoreLabel})`);
        res.json({ idea: updated, scoring, intel });
    } catch (err) {
        console.error('[Ideas Validate]', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
