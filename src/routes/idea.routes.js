const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'assets/uploads/' });
const csv = require('csv-parser');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { assetQueue } = require('../queues/index');

const riskService = require('../services/risk.service');
const { VISION_SCHEMA } = require('../services/vision.service');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const prisma = new PrismaClient();

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

        // 3. Image kaydı oluştur (APPROVED) ve AssetWorker kuyruğuna ekle
        //    Worker bu image'ı yakalar, BG remove + mockup + SEO işlemlerini yapar.
        const prompt = `${idea.styleEnum} style POD design: ${idea.hook} — niche: ${idea.niche}, keyword: ${idea.mainKeyword}`;
        const image = await prisma.image.create({
            data: {
                jobId: job.id,
                variantType: 'idea_generated',
                promptUsed: prompt,
                engine: 'idea_pipeline',
                imageUrl: '',           // FAL entegrasyonu eklendiğinde doldurulacak
                status: 'APPROVED',
                isApproved: true,
                cost: 0,
            }
        });
        console.log('[Ideas/Factory] Image kaydı oluşturuldu:', image.id);

        console.log('[API] İşi Redis kuyruğuna fırlatıyor. Kuyruk:', assetQueue.name, '| imageId:', image.id);
        await assetQueue.add('processAsset', { imageId: image.id }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 }
        });
        console.log('[Ideas/Factory] AssetWorker kuyruğuna eklendi.');

        // 4. Mark Idea as factory sent
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

module.exports = router;
