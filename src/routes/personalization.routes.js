'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();
const prisma  = require('../lib/prisma');
const { uploadToStorage }        = require('../services/storage.service');
const { generateFuryTourPoster } = require('../services/photo-composite.service');

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

// Etsy'nin "supports_multiple_personalization_questions" formatı resmi dokümanda
// tam netleşmemiş — birden fazla property_id:54 objesi olabileceği belirtiliyor
// ama hangisinin hangi soruya ait olduğunu ayırt eden bir alan (question_id vb.)
// yok. Burada URL-şekilli değeri foto, diğerini pet adı sayıyoruz. Gerçek bir
// test siparişiyle doğrulanmalı.
function extractPersonalizationAnswers(transaction) {
  const variations = transaction.variations || [];
  const personalizationVars = variations.filter(v => v.property_id === 54);
  let photoUrl = null;
  let petName  = null;
  for (const v of personalizationVars) {
    const val = String(v.formatted_value || '').trim();
    if (!val) continue;
    if (/^https?:\/\//i.test(val)) {
      if (!photoUrl) photoUrl = val;
    } else if (!petName) {
      petName = val;
    }
  }
  return { photoUrl, petName };
}

// POST /api/personalization/orders
router.post('/orders', upload.single('customerPhoto'), async (req, res) => {
  let order = null;
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
    if (!variables.petName) return res.status(400).json({ error: 'variables.petName required' });

    const template = await prisma.photoTemplate.findFirst({
      where: { id: templateId, workspaceId: req.workspaceId, active: true },
    });
    if (!template) return res.status(404).json({ error: 'PhotoTemplate not found' });

    const ext      = path.extname(req.file.originalname) || '.jpg';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const storePath = `personalization/customer-photos/${filename}`;
    const photoUrl  = await uploadToStorage(req.file.path, storePath);
    try { fs.unlinkSync(req.file.path); } catch (_) {}

    order = await prisma.personalizationOrder.create({
      data: {
        workspaceId:      req.workspaceId,
        templateId,
        customerPhotoUrl: photoUrl,
        variables,
        etsyOrderRef:     etsyOrderRef || null,
        status:           'COMPOSITING',
      },
    });

    // Sharp-only, no AI call — fast enough to run inline, no queue needed.
    const { buffer } = await generateFuryTourPoster({
      customerPhotoPath: photoUrl,
      petName:           variables.petName,
      templateConfig: {
        photoSlot:  template.photoSlot,
        tintColor:  template.mockupConfig?.tintColor,
        cities:     template.mockupConfig?.cities,
      },
      fabricBlend:     template.mockupConfig?.fabricBlend === true,
      fabricIntensity: template.mockupConfig?.fabricIntensity,
    });

    const tmpPrint = path.join('uploads/temp', `${order.id}_print.png`);
    fs.writeFileSync(tmpPrint, buffer);
    let printFileUrl;
    try {
      printFileUrl = await uploadToStorage(tmpPrint, `personalization/print-files/${order.id}_print.png`);
    } finally {
      try { fs.unlinkSync(tmpPrint); } catch (_) {}
    }

    order = await prisma.personalizationOrder.update({
      where: { id: order.id },
      data:  { status: 'COMPOSITED', printFileUrl },
    });

    res.status(201).json({ success: true, order });
  } catch (err) {
    console.error('[Personalization POST /orders]', err.message);
    if (order) {
      await prisma.personalizationOrder.update({
        where: { id: order.id },
        data:  { status: 'FAILED', rejectionReason: err.message },
      }).catch(() => {});
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/personalization/preview — no DB write, returns base64 PNG for quick testing
router.post('/preview', upload.single('customerPhoto'), async (req, res) => {
  try {
    const { petName, fabricBlend, fabricIntensity } = req.body;
    if (!req.file) return res.status(400).json({ error: 'customerPhoto file required' });
    if (!petName)  return res.status(400).json({ error: 'petName required' });

    let templateConfig = {};
    if (req.body.templateConfig) {
      try { templateConfig = JSON.parse(req.body.templateConfig); } catch (_) {
        return res.status(400).json({ error: 'templateConfig must be a valid JSON string' });
      }
    }

    const { buffer } = await generateFuryTourPoster({
      customerPhotoPath: req.file.path,
      petName,
      templateConfig,
      fabricBlend:     fabricBlend === 'true' || fabricBlend === true,
      fabricIntensity: fabricIntensity !== undefined ? parseFloat(fabricIntensity) : undefined,
    });

    res.json({
      success:    true,
      previewUrl: `data:image/png;base64,${buffer.toString('base64')}`,
    });
  } catch (err) {
    console.error('[Personalization POST /preview]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (_) {} }
  }
});

// POST /api/personalization/sync-etsy-orders — ödemesi geçmiş yeni Etsy
// siparişlerini çeker, personalization cevaplarından (foto+isim) otomatik
// PersonalizationOrder oluşturup composite eder. Şimdilik workspace'teki tek
// aktif PhotoTemplate'e sabit — çoklu ürüne geçilince listing_id eşlemesi eklenir.
router.post('/sync-etsy-orders', async (req, res) => {
  try {
    const etsy = require('../services/etsy-api.service');
    const fetch = require('node-fetch');

    const template = await prisma.photoTemplate.findFirst({
      where: { workspaceId: req.workspaceId, active: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!template) {
      return res.status(400).json({ error: 'Aktif PhotoTemplate bulunamadı — önce bir şablon oluştur.' });
    }

    const receipts = await etsy.getNewReceipts(req.workspaceId);

    const created = [];
    const skipped = [];
    const errors  = [];

    for (const receipt of receipts) {
      const receiptId = String(receipt.receipt_id);

      const existing = await prisma.personalizationOrder.findFirst({
        where: { workspaceId: req.workspaceId, etsyOrderRef: receiptId },
      });
      if (existing) { skipped.push(receiptId); continue; }

      for (const tx of receipt.transactions || []) {
        let order = null;
        try {
          const { photoUrl, petName } = extractPersonalizationAnswers(tx);
          if (!photoUrl || !petName) continue; // bu transaction'da personalization cevabı eksik

          const photoRes = await fetch(photoUrl);
          if (!photoRes.ok) throw new Error(`Foto indirilemedi: HTTP ${photoRes.status}`);
          const photoBuffer = Buffer.from(await photoRes.arrayBuffer());

          order = await prisma.personalizationOrder.create({
            data: {
              workspaceId:      req.workspaceId,
              templateId:       template.id,
              customerPhotoUrl: photoUrl,
              variables:        { petName },
              etsyOrderRef:     receiptId,
              status:           'COMPOSITING',
            },
          });

          const { buffer } = await generateFuryTourPoster({
            customerPhotoPath: photoBuffer,
            petName,
            templateConfig: {
              photoSlot: template.photoSlot,
              tintColor: template.mockupConfig?.tintColor,
              cities:    template.mockupConfig?.cities,
            },
            fabricBlend:     template.mockupConfig?.fabricBlend === true,
            fabricIntensity: template.mockupConfig?.fabricIntensity,
          });

          const tmpPrint = path.join('uploads/temp', `${order.id}_print.png`);
          fs.writeFileSync(tmpPrint, buffer);
          let printFileUrl;
          try {
            printFileUrl = await uploadToStorage(tmpPrint, `personalization/print-files/${order.id}_print.png`);
          } finally {
            try { fs.unlinkSync(tmpPrint); } catch (_) {}
          }

          await prisma.personalizationOrder.update({
            where: { id: order.id },
            data:  { status: 'COMPOSITED', printFileUrl },
          });

          created.push({ receiptId, orderId: order.id });
        } catch (txErr) {
          console.error(`[Personalization SyncEtsy] receipt ${receiptId} hata:`, txErr.message);
          if (order) {
            await prisma.personalizationOrder.update({
              where: { id: order.id },
              data:  { status: 'FAILED', rejectionReason: txErr.message },
            }).catch(() => {});
          }
          errors.push({ receiptId, error: txErr.message });
        }
      }
    }

    res.json({ success: true, created, skipped, errors });
  } catch (err) {
    console.error('[Personalization POST /sync-etsy-orders]', err.message);
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
