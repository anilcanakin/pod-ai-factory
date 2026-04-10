const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const brainService = require('../services/multimodal-brain.service');

// Configure multer for video uploads
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
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit for now
});

/**
 * GET /api/brain
 * List all corporate memories
 */
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

/**
 * POST /api/brain/ingest-video
 * Upload and process a video
 */
router.post('/ingest-video', upload.single('video'), async (req, res) => {
  try {
    const { title, type, workspaceId } = req.body;
    const videoFile = req.file;

    if (!videoFile) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    // Process in background if it's a large video, but for now we'll wait or use a long timeout
    // In a real app, this should be a BullMQ job.
    const memory = await brainService.processVideo(
      workspaceId || 'default-workspace', // Fallback for testing
      videoFile.path,
      title || videoFile.originalname,
      type || 'VIDEO_TUTORIAL'
    );

    res.json(memory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/brain/:id
 */
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
