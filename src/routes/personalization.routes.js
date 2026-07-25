'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();
const prisma  = require('../lib/prisma');
const { uploadToStorage }         = require('../services/storage.service');
const { generateFuryTourPoster }  = require('../services/photo-composite.service');
const { generatePetPortrait }     = require('../services/pet-portrait-composite.service');
const { composeTextOnlyDesign }   = require('../services/composite-engine.service');

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

const petPortraitUpload = multer({
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
// form-data / JSON body'den gelen boolean flag'leri parse eder — undefined ise
// dokunmaz (generateFuryTourPoster'ın kendi default'u — true — geçerli olur).
function parseBoolFlag(val) {
  if (val === undefined) return undefined;
  if (typeof val === 'boolean') return val;
  return val === 'true';
}

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

    // AI dönüşüm (fal-ai/gpt-image-2) + fabricBlend varsayılan açık — 180s'e kadar
    // sürebilir, sipariş akışı senkron bekliyor (kuyruğa alınmadı).
    const { buffer } = await generateFuryTourPoster({
      customerPhotoPath: photoUrl,
      petName:           variables.petName,
      templateConfig: {
        photoSlot:  template.photoSlot,
        tintColor:  template.mockupConfig?.tintColor,
        cities:     template.mockupConfig?.cities,
      },
      useAI:           template.mockupConfig?.useAI !== false,
      fabricBlend:     template.mockupConfig?.fabricBlend !== false,
      fabricIntensity: template.mockupConfig?.fabricIntensity,
      workspaceId:     req.workspaceId,
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
    const { petName, fabricBlend, fabricIntensity, useAI } = req.body;
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
      useAI:           parseBoolFlag(useAI),
      fabricBlend:     parseBoolFlag(fabricBlend),
      fabricIntensity: fabricIntensity !== undefined ? parseFloat(fabricIntensity) : undefined,
      workspaceId:     req.workspaceId,
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
            useAI:           template.mockupConfig?.useAI !== false,
            fabricBlend:     template.mockupConfig?.fabricBlend !== false,
            fabricIntensity: template.mockupConfig?.fabricIntensity,
            workspaceId:     req.workspaceId,
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

// ─── Fotoğrafsız apparel personalizasyonu ("text_only") ──────────────────────
// Grade Team, Custom Name Nurse, Family Vacation, Faith Over Fear gibi tasarımlar:
// AI'a her siparişte yeniden gitmiyor. Master tasarım (isim/tarih yeri boş) bir kez
// üretilmiş, DB'de PhotoTemplate.baseArtworkUrl olarak duruyor. Her sipariş sadece
// composeTextOnlyDesign ile kod-render metin basar — hızlı, ücretsiz, deterministik.

// POST /api/personalization/text-orders
router.post('/text-orders', async (req, res) => {
  let order = null;
  try {
    const { templateId, variables: variablesRaw, etsyOrderRef } = req.body;
    if (!templateId) return res.status(400).json({ error: 'templateId required' });

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
    if (template.templateType !== 'text_only') {
      return res.status(400).json({ error: `Template type must be "text_only", got "${template.templateType}"` });
    }

    order = await prisma.personalizationOrder.create({
      data: {
        workspaceId:  req.workspaceId,
        templateId,
        variables,
        etsyOrderRef: etsyOrderRef || null,
        status:       'COMPOSITING',
      },
    });

    const buffer = await composeTextOnlyDesign(template.baseArtworkUrl, template, variables);

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
    console.error('[Personalization POST /text-orders]', err.message);
    if (order) {
      await prisma.personalizationOrder.update({
        where: { id: order.id },
        data:  { status: 'FAILED', rejectionReason: err.message },
      }).catch(() => {});
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/personalization/text-orders/preview — DB kaydı yok, hızlı görsel test
router.post('/text-orders/preview', async (req, res) => {
  try {
    const { templateId, variables: variablesRaw } = req.body;
    if (!templateId) return res.status(400).json({ error: 'templateId required' });

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
    if (template.templateType !== 'text_only') {
      return res.status(400).json({ error: `Template type must be "text_only", got "${template.templateType}"` });
    }

    const buffer = await composeTextOnlyDesign(template.baseArtworkUrl, template, variables);
    res.json({ success: true, previewUrl: `data:image/png;base64,${buffer.toString('base64')}` });
  } catch (err) {
    console.error('[Personalization POST /text-orders/preview]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Custom Owner & Pet Portrait ("multi_photo_generative") ──────────────────
// bkz. görev notu: sabit baseArtworkUrl yok, 2 fotoğraf (person + pet) AI ile
// tek sahneye birleştirilip stilize edilir — mevcut frame/photoSlot akışından ayrı.

async function findOrCreatePetPortraitJob(workspaceId) {
  let job = await prisma.designJob.findFirst({
    where: { workspaceId, mode: 'pet_portrait_preview' },
  });
  if (!job) {
    job = await prisma.designJob.create({
      data: {
        workspaceId,
        originalImage: 'pet_portrait_preview',
        mode:          'pet_portrait_preview',
        status:        'COMPLETED',
        basePrompt:    'Custom Owner & Pet Portrait',
      },
    });
  }
  return job;
}

// POST /api/personalization/pet-portrait/preview — 2 fotoğraf (person + pet) alır,
// 4 adımlı pipeline'ı senkron çalıştırır, base64 PNG + previewId (Image kaydı,
// status: PENDING_APPROVAL) döner. Sipariş onaylanmadan önce bu önizleme ZORUNLU.
router.post(
  '/pet-portrait/preview',
  petPortraitUpload.fields([{ name: 'personPhoto', maxCount: 1 }, { name: 'petPhoto', maxCount: 1 }]),
  async (req, res) => {
    const tempFiles = [];
    try {
      if (!req.workspaceId) return res.status(401).json({ error: 'Authentication required' });

      const { templateId } = req.body;
      const personFile = req.files?.personPhoto?.[0];
      const petFile     = req.files?.petPhoto?.[0];
      if (!templateId)  return res.status(400).json({ error: 'templateId required' });
      if (!personFile)  return res.status(400).json({ error: 'personPhoto file required' });
      if (!petFile)      return res.status(400).json({ error: 'petPhoto file required' });
      tempFiles.push(personFile.path, petFile.path);

      const names = typeof req.body.names === 'string' ? req.body.names.trim() : '';

      const template = await prisma.photoTemplate.findFirst({
        where: { id: templateId, workspaceId: req.workspaceId, active: true },
      });
      if (!template) return res.status(404).json({ error: 'PhotoTemplate not found' });
      if (template.templateType !== 'multi_photo_generative') {
        return res.status(400).json({ error: `Template type must be "multi_photo_generative", got "${template.templateType}"` });
      }

      const { buffer } = await generatePetPortrait({
        personPhotoPath: personFile.path,
        petPhotoPath:    petFile.path,
        template,
        names,
        workspaceId: req.workspaceId,
      });

      // Orijinal 2 fotoğrafı da kalıcı depoya taşı — onaylanan sipariş oluşturulurken
      // (POST /pet-portrait/orders) previewId üzerinden bu URL'lere geri dönülür.
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const personPhotoUrl = await uploadToStorage(personFile.path, `personalization/pet-portrait/inputs/${stamp}_person${path.extname(personFile.originalname) || '.jpg'}`);
      const petPhotoUrl    = await uploadToStorage(petFile.path, `personalization/pet-portrait/inputs/${stamp}_pet${path.extname(petFile.originalname) || '.jpg'}`);

      const tmpPreview = path.join('uploads/temp', `${stamp}_preview.jpg`);
      fs.writeFileSync(tmpPreview, buffer);
      let previewUrl;
      try {
        previewUrl = await uploadToStorage(tmpPreview, `personalization/pet-portrait/previews/${stamp}.jpg`);
      } finally {
        try { fs.unlinkSync(tmpPreview); } catch (_) {}
      }

      const job = await findOrCreatePetPortraitJob(req.workspaceId);
      const previewImage = await prisma.image.create({
        data: {
          jobId:       job.id,
          variantType: 'pet_portrait_preview',
          promptUsed:  'Custom Owner & Pet Portrait preview',
          engine:      'pet_portrait_preview',
          imageUrl:    previewUrl,
          status:      'PENDING_APPROVAL',
          isApproved:  false,
          cost:        0,
          // Onaylanan sipariş oluşturulurken ihtiyaç duyulan bağlam (orijinal fotoğraf
          // URL'leri + templateId + names) — ayrı bir kolon eklemek yerine mevcut
          // rawResponse (Text) alanına JSON olarak gömülüyor.
          rawResponse: JSON.stringify({ templateId, personPhotoUrl, petPhotoUrl, names }),
        },
      });

      res.json({
        success:    true,
        previewId:  previewImage.id,
        previewUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
        storedUrl:  previewUrl,
      });
    } catch (err) {
      console.error('[Personalization POST /pet-portrait/preview]', err.message);
      res.status(500).json({ error: err.message });
    } finally {
      for (const p of tempFiles) { try { fs.unlinkSync(p); } catch (_) {} }
    }
  }
);

// POST /api/personalization/pet-portrait/orders — onaylanmış bir preview'den
// (previewId) gerçek PersonalizationOrder oluşturur. Kompozisyon zaten preview
// adımında tamamlandığı için burada yeniden AI çağrısı yapılmaz.
router.post('/pet-portrait/orders', async (req, res) => {
  try {
    if (!req.workspaceId) return res.status(401).json({ error: 'Authentication required' });

    const { previewId, etsyOrderRef } = req.body;
    if (!previewId) return res.status(400).json({ error: 'previewId required' });

    const preview = await prisma.image.findFirst({
      where: { id: previewId, engine: 'pet_portrait_preview' },
      include: { job: true },
    });
    if (!preview) return res.status(404).json({ error: 'Preview not found' });
    if (preview.job.workspaceId !== req.workspaceId) return res.status(403).json({ error: 'Forbidden' });
    if (preview.status !== 'PENDING_APPROVAL') {
      return res.status(400).json({ error: `Preview already consumed or invalid (status: ${preview.status})` });
    }

    let context = {};
    try { context = JSON.parse(preview.rawResponse || '{}'); } catch (_) { context = {}; }
    const { templateId, personPhotoUrl, petPhotoUrl, names } = context;
    if (!templateId) return res.status(500).json({ error: 'Preview context corrupted — templateId missing' });

    const template = await prisma.photoTemplate.findFirst({
      where: { id: templateId, workspaceId: req.workspaceId },
    });
    if (!template) return res.status(404).json({ error: 'PhotoTemplate not found' });

    const order = await prisma.personalizationOrder.create({
      data: {
        workspaceId:       req.workspaceId,
        templateId,
        customerPhotoUrls: [personPhotoUrl, petPhotoUrl],
        previewImageId:    preview.id,
        variables:         { names: names || '' },
        etsyOrderRef:      etsyOrderRef || null,
        status:            'COMPOSITED',
        printFileUrl:       preview.imageUrl,
      },
    });

    await prisma.image.update({
      where: { id: preview.id },
      data:  { status: 'APPROVED', isApproved: true },
    });

    res.status(201).json({ success: true, order });
  } catch (err) {
    console.error('[Personalization POST /pet-portrait/orders]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
