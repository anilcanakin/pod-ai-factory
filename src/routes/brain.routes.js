const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { OpenAI } = require('openai');
const brainService = require('../services/multimodal-brain.service');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Multer — video uploads up to 500MB
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(process.cwd(), 'assets', 'uploads', 'brain');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, `brain-${Date.now()}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 1000 * 1024 * 1024 } // 1GB (Ağır strateji videoları için)
});

// ─── GET /api/brain — List all corporate memories ─────────────────────────────
router.get('/', async (req, res) => {
    try {
        const memories = await prisma.corporateMemory.findMany({
            where: { isActive: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(memories);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── GET /api/brain/knowledge — Grouped knowledge entries ────────────────────
router.get('/knowledge', async (req, res) => {
    try {
        const all = await prisma.corporateMemory.findMany({
            where: { isActive: true },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                type: true,
                title: true,
                content: true,
                sourceUrl: true,
                analysisResult: true,
                createdAt: true
            }
        });

        // Group by source type
        const grouped = {
            video: all.filter(m => ['VIDEO_TUTORIAL', 'VIDEO_FULL'].includes(m.type)),
            text: all.filter(m => m.type === 'TEXT_NOTE'),
            auto: all.filter(m => !['VIDEO_TUTORIAL', 'VIDEO_FULL', 'TEXT_NOTE'].includes(m.type))
        };

        res.json({ entries: all, grouped, total: all.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── POST /api/brain/ingest-video — Legacy Gemini endpoint ───────────────────
router.post('/ingest-video', upload.single('video'), async (req, res) => {
    try {
        const { title, type, workspaceId } = req.body;
        const videoFile = req.file;

        if (!videoFile) return res.status(400).json({ error: 'No video file provided' });

        const memory = await brainService.processVideo(
            workspaceId || req.workspaceId || 'default-workspace',
            videoFile.path,
            title || videoFile.originalname,
            type || 'VIDEO_TUTORIAL'
        );

        res.json(memory);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── POST /api/brain/analyze-video — Enhanced Claude+Whisper analysis ────────
router.post('/analyze-video', upload.single('video'), async (req, res) => {
    try {
        const { title, videoType, workspaceId, category } = req.body;
        const videoFile = req.file;

        if (!videoFile) return res.status(400).json({ error: 'No video file provided' });

        const validTypes = ['training', 'meeting', 'etsy_update', 'tutorial'];
        const type = validTypes.includes(videoType) ? videoType : 'training';

        const result = await brainService.analyzeVideoFull(
            workspaceId || req.workspaceId || 'default-workspace',
            videoFile.path,
            title || videoFile.originalname.replace(/\.[^/.]+$/, ''),
            type,
            category || null
        );

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── POST /api/brain/add-text — Paste text directly into knowledge base ──────
router.post('/add-text', async (req, res) => {
    try {
        const { title, content, source, category } = req.body;
        const workspaceId = req.workspaceId || 'default-workspace';

        if (!title || !content) {
            return res.status(400).json({ error: 'title and content are required' });
        }

        const result = await brainService.addTextKnowledge(
            workspaceId,
            title,
            content,
            source || 'manual',
            category || null
        );

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── POST /api/brain/ingest-social — Social Media Intelligence ───────────
router.post('/ingest-social', upload.single('image'), async (req, res) => {
    try {
        const { title, workspaceId } = req.body;
        const imageFile = req.file;

        if (!imageFile) return res.status(400).json({ error: 'No image file provided' });

        const localBrainService = require('../services/brain.service');
        const memory = await localBrainService.ingestSocialProof(
            workspaceId || req.workspaceId || 'default-workspace',
            imageFile.path,
            title || `Social Proof - ${path.basename(imageFile.path)}`
        );

        res.json({
            message: 'Social intelligence captured successfully',
            memoryId: memory.id,
            analysis: memory.analysisResult
        });
    } catch (error) {
        console.error('[Brain Routes] Social Ingestion Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ─── POST /api/brain/ingest-expert — Expert Subscription Signals ──────────
router.post('/ingest-expert', upload.single('image'), async (req, res) => {
    try {
        const { title, workspaceId } = req.body;
        const imageFile = req.file;

        if (!imageFile) return res.status(400).json({ error: 'No image file provided' });

        const localBrainService = require('../services/brain.service');
        const memory = await localBrainService.ingestExpertInsight(
            workspaceId || req.workspaceId || 'default-workspace',
            imageFile.path,
            title || `Expert Insight - ${path.basename(imageFile.path)}`
        );

        res.json({
            message: 'Expert insight captured successfully',
            memoryId: memory.id,
            analysis: memory.analysisResult
        });
    } catch (error) {
        console.error('[Brain Routes] Expert Ingestion Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ─── POST /api/brain/test-knowledge — Q&A against stored knowledge ───────────
router.post('/test-knowledge', async (req, res) => {
    try {
        const { question } = req.body;
        if (!question) return res.status(400).json({ error: 'question required' });

        const workspaceId = req.workspaceId || 'default-workspace';
        const Anthropic = require('@anthropic-ai/sdk');
        const { getKnowledge } = require('../services/seo-knowledge.service');

        // 1. Generate embedding for the query using OpenAI text-embedding-3-small
        const embeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: question
        });
        const embedding = embeddingResponse.data[0].embedding;

        // 2. Semantic search via pgvector cosine similarity
        let memories;
        try {
            memories = await prisma.$queryRaw`
                SELECT id, type, title, content, category, "analysisResult",
                       1 - ("vectorEmbedding"::text::vector <=> ${JSON.stringify(embedding)}::vector) AS similarity
                FROM "CorporateMemory"
                WHERE "workspaceId" = ${workspaceId}
                  AND "isActive" = true
                  AND "vectorEmbedding" IS NOT NULL
                ORDER BY "vectorEmbedding"::text::vector <=> ${JSON.stringify(embedding)}::vector
                LIMIT 5
            `;
        } catch (pgErr) {
            // Fallback to recency-based search if pgvector is unavailable
            console.warn('[Brain] pgvector search failed, falling back to recency search:', pgErr.message);
            memories = await prisma.corporateMemory.findMany({
                where: { workspaceId, isActive: true },
                orderBy: { createdAt: 'desc' },
                take: 5
            });
        }

        const seoKnowledge = await getKnowledge(workspaceId);

        const knowledgeContext = memories
            .map(m => {
                const ar = m.analysisResult;
                if (!ar) return '';
                return ar.synthesis || (ar.actionableRules?.map(r => `IF ${r.condition} THEN ${r.action}`).join('\n')) || '';
            })
            .filter(Boolean)
            .join('\n\n---\n\n');

        const client = new Anthropic();
        const response = await client.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 1000,
            system: `You are an Etsy POD business expert assistant.
Answer questions based ONLY on the knowledge base provided below.
If the knowledge base doesn't contain relevant information, say so clearly.
Be specific and actionable in your answers.

KNOWLEDGE BASE (${memories.length} entries):
${knowledgeContext.slice(0, 4000)}

SEO KNOWLEDGE:
${seoKnowledge.slice(0, 2000)}`,
            messages: [{ role: 'user', content: question }]
        });

        res.json({
            answer: response.content[0].text,
            sourcesUsed: memories.length,
            question,
            memories: memories.map(m => ({
                id: m.id,
                title: m.title,
                category: m.category,
                similarity: m.similarity != null ? Number(m.similarity) : null
            }))
        });
    } catch (err) {
        console.error('[Brain Test]', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /api/brain/summary — Knowledge base freshness indicator ──────────────
router.get('/summary', async (req, res) => {
    try {
        const { getKnowledgeSummary } = require('../services/knowledge-context.service');
        const summary = await getKnowledgeSummary(req.workspaceId || 'default-workspace');
        res.json(summary);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── DELETE /api/brain/:id — Soft-delete a memory ────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        await prisma.corporateMemory.update({
            where: { id: req.params.id },
            data: { isActive: false }
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
