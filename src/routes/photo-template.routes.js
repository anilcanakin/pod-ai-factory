'use strict';

const express = require('express');
const router  = express.Router();
const prisma  = require('../lib/prisma');

// POST /api/photo-templates — create
router.post('/', async (req, res) => {
  try {
    const { name, occasion, baseArtworkUrl, photoSlot, textLayers,
            printWidthPx, printHeightPx, mockupConfig } = req.body;

    if (!name || !occasion || !baseArtworkUrl || !photoSlot || !textLayers
        || printWidthPx == null || printHeightPx == null || !mockupConfig) {
      return res.status(400).json({
        error: 'Missing required fields: name, occasion, baseArtworkUrl, photoSlot, textLayers, printWidthPx, printHeightPx, mockupConfig',
      });
    }

    const template = await prisma.photoTemplate.create({
      data: {
        workspaceId:   req.workspaceId,
        name,
        occasion,
        baseArtworkUrl,
        photoSlot,
        textLayers,
        printWidthPx:  parseInt(printWidthPx, 10),
        printHeightPx: parseInt(printHeightPx, 10),
        mockupConfig,
        active: req.body.active !== false,
      },
    });

    res.status(201).json({ success: true, template });
  } catch (err) {
    console.error('[PhotoTemplates POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/photo-templates — list active templates for workspace
router.get('/', async (req, res) => {
  try {
    const { occasion } = req.query;
    const where = { workspaceId: req.workspaceId, active: true };
    if (occasion) where.occasion = occasion;

    const templates = await prisma.photoTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, templates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/photo-templates/:id — single
router.get('/:id', async (req, res) => {
  try {
    const template = await prisma.photoTemplate.findFirst({
      where: { id: req.params.id, workspaceId: req.workspaceId },
    });
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json({ success: true, template });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/photo-templates/:id — update
router.patch('/:id', async (req, res) => {
  try {
    const existing = await prisma.photoTemplate.findFirst({
      where: { id: req.params.id, workspaceId: req.workspaceId },
    });
    if (!existing) return res.status(404).json({ error: 'Template not found' });

    const allowed = ['name', 'occasion', 'baseArtworkUrl', 'photoSlot', 'textLayers',
                     'printWidthPx', 'printHeightPx', 'mockupConfig', 'active'];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }

    const template = await prisma.photoTemplate.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ success: true, template });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
