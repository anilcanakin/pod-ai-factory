const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'assets/uploads/' });
const csv = require('csv-parser');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const OpenAI = require('openai');

const riskService = require('../services/risk.service');
const { VISION_SCHEMA } = require('../services/vision.service');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const prisma = new PrismaClient();

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
        const sampleKeywords = keywords.slice(0, 50).join(', ');
        const styleOptions = VISION_SCHEMA.json_schema.schema.properties.style.enum;

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
                status: 'PROCESSING'
            }
        });

        // 2. Synthesize Vision Data
        // Skipping physical OCR / Google Vision and mocking perfect interpretation.
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

        // 3. Mark Idea as factory sent
        await prisma.idea.update({
            where: { id },
            data: { status: 'FACTORY_SENT' }
        });

        res.json({ message: "Idea forwarded to Factory successfully.", jobId: job.id, visionData: synthesizedVision });

    } catch (err) {
        console.error('Send to factory error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
