const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const brainService = require('../services/multimodal-brain.service');

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
    limits: { fileSize: 500 * 1024 * 1024 } // 500MB
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
        const { title, videoType, workspaceId } = req.body;
        const videoFile = req.file;

        if (!videoFile) return res.status(400).json({ error: 'No video file provided' });

        const validTypes = ['training', 'meeting', 'etsy_update', 'tutorial'];
        const type = validTypes.includes(videoType) ? videoType : 'training';

        const result = await brainService.analyzeVideoFull(
            workspaceId || req.workspaceId || 'default-workspace',
            videoFile.path,
            title || videoFile.originalname.replace(/\.[^/.]+$/, ''),
            type
        );

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── POST /api/brain/add-text — Paste text directly into knowledge base ──────
router.post('/add-text', async (req, res) => {
    try {
        const { title, content, source } = req.body;
        const workspaceId = req.workspaceId || 'default-workspace';

        if (!title || !content) {
            return res.status(400).json({ error: 'title and content are required' });
        }

        const result = await brainService.addTextKnowledge(
            workspaceId,
            title,
            content,
            source || 'manual'
        );

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
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
