'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();
const prisma  = require('../lib/prisma');
const { uploadToStorage }      = require('../services/storage.service');
const { personalizationQueue } = require('../queues/index');

const upload = multer({
  dest: 'uploads/temp/',
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files allowed'));
    }
    cb(null, true);
  },
});

// POST /api/personalization/orders
router.post('/orders', upload.single('customerPhoto'), async (req, res) => {
  try {
    const { templateId, variables: variablesRaw, etsyOrderRef } = req.body;

    if (!templateId)  return res.status(400).json({ error: 'templateId required' });
    if (!req.file)    return res.status(400).json({ error: 'customerPhoto file required' });

    let variables = {};
    if (variablesRaw) {
      try { variables = JSON.parse(variablesRaw); } catch (_) {
        return res.status(400).json({ error: 'variables must be a valid JSON string' });
      }
    }

    const template = await prisma.photoTemplate.findFirst({
      where: { id: templateId, workspaceId: req.workspaceId, active: true },
    });
    if (!template) return res.status(404).json({ error: 'PhotoTemplate not found' });

    const ext      = path.extname(req.file.originalname) || '.jpg';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const storePath = `personalization/customer-photos/${filename}`;
    const photoUrl  = await uploadToStorage(req.file.path, storePath);
    try { fs.unlinkSync(req.file.path); } catch (_) {}

    const order = await prisma.personalizationOrder.create({
      data: {
        workspaceId:      req.workspaceId,
        templateId,
        customerPhotoUrl: photoUrl,
        variables,
        etsyOrderRef:     etsyOrderRef || null,
        status:           'PENDING',
      },
    });

    await personalizationQueue.add('composite', {
      orderId:     order.id,
      workspaceId: req.workspaceId,
    });

    res.status(201).json({ success: true, order });
  } catch (err) {
    console.error('[Personalization POST /orders]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/personalization/orders?status=
router.get('/orders', async (req, res) => {
  try {
    const { status, limit = '50', offset = '0' } = req.query;
    const where = { workspaceId: req.workspaceId };
    if (status) where.status = status.toUpperCase();

    const orders = await prisma.personalizationOrder.findMany({
      where,
      include: { template: { select: { name: true, occasion: true } } },
      orderBy: { createdAt: 'desc' },
      take:    Math.min(parseInt(limit, 10) || 50, 100),
      skip:    parseInt(offset, 10) || 0,
    });

    res.json({ success: true, orders, count: orders.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/personalization/orders/:id
router.get('/orders/:id', async (req, res) => {
  try {
    const order = await prisma.personalizationOrder.findFirst({
      where:   { id: req.params.id, workspaceId: req.workspaceId },
      include: { template: true },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/personalization/orders/:id/approve
router.post('/orders/:id/approve', async (req, res) => {
  try {
    const order = await prisma.personalizationOrder.findFirst({
      where: { id: req.params.id, workspaceId: req.workspaceId },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'COMPOSITED') {
      return res.status(400).json({
        error: `Cannot approve order with status ${order.status}. Expected COMPOSITED.`,
      });
    }
    const updated = await prisma.personalizationOrder.update({
      where: { id: req.params.id },
      data:  { status: 'APPROVED' },
    });
    res.json({ success: true, order: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/personalization/orders/:id/reject
router.post('/orders/:id/reject', async (req, res) => {
  try {
    const order = await prisma.personalizationOrder.findFirst({
      where: { id: req.params.id, workspaceId: req.workspaceId },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!['COMPOSITED', 'PENDING', 'COMPOSITING'].includes(order.status)) {
      return res.status(400).json({
        error: `Cannot reject order with status ${order.status}`,
      });
    }
    const updated = await prisma.personalizationOrder.update({
      where: { id: req.params.id },
      data:  { status: 'REJECTED', rejectionReason: req.body.reason || null },
    });
    res.json({ success: true, order: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
