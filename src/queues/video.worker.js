'use strict';

/**
 * video.worker.js
 *
 * Processes mockup → video-mockup jobs (image-to-video, subtle motion).
 * Retry strategy: internal primary/fallback model chain — NOT BullMQ job
 * retries (attempts:1, see queues/index.js) since a failed video job is
 * expensive to retry blindly (both models already get one attempt each).
 * Status machine on Mockup row: pending → done | failed
 *
 * mode: 'single' (default) — bir klip, MOTION_PROMPTS[motionType]
 * mode: 'reel'             — REEL_SEQUENCE'daki her hareket için ayrı klip
 *                             üretilir, ffmpeg ile tek videoda birleştirilir.
 *                             Bir klip başarısız olursa reel'den atlanır (en az
 *                             1 klip başarılıysa reel yine üretilir).
 */

const { Worker } = require('bullmq');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const { fal } = require('@fal-ai/client');
const redisConnection = require('../config/redis');
const prisma = require('../lib/prisma');
const { uploadUrlToStorage, uploadToStorage } = require('../services/storage.service');
const { logNotification } = require('../routes/notification.routes');

fal.config({ credentials: process.env.FAL_API_KEY || process.env.FAL_KEY });

const MAX_INPUT_BYTES = 9 * 1024 * 1024; // FAL sınırı 10MB — 9MB'a küçültüp pay bırak
const REEL_SEQUENCE = ['rotate', 'zoom', 'subtle'];

// Etsy sesi zaten kaldırıyor + amaç ürün tanıtımı, rastgele sahne/anlatı istemiyoruz —
// tüm prompt'lar sabit kamera + sessiz + ürün odaklı olacak şekilde yönlendiriliyor.
const MOTION_PROMPTS = {
  subtle: 'static locked-off camera, no camera movement, product photography, subtle fabric movement in a gentle breeze, no people, no scene change, silent, focused entirely on the garment',
  rotate: 'static camera position, slow smooth 360 degree product rotation, studio lighting, no people, silent, product showcase, no scene change',
  wave:   'static locked-off camera, no camera movement, fabric gently waving in a light breeze, product focus, no people, silent, no scene change',
  zoom:   'static camera, slow smooth zoom in on the garment design, product photography, no people, silent, no scene change',
};

async function resolveLocalImagePath(mockupUrl) {
  if (mockupUrl.startsWith('http')) {
    const fetch = require('node-fetch');
    const res = await fetch(mockupUrl);
    if (!res.ok) throw new Error(`Mockup görseli indirilemedi: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const tmp = path.join(os.tmpdir(), `video-src-${Date.now()}.png`);
    fs.writeFileSync(tmp, buf);
    return tmp;
  }
  return path.join(__dirname, '../../', mockupUrl.split('?')[0]);
}

// FAL'ın 10MB input limiti — mockup render'lar 5000x3750'de 15-21MB'a çıkabiliyor
// (upscale özelliğinde de aynı sınıf soruna rastlanmıştı). Boyut aşılıyorsa kaliteyi
// düşürüp/küçültüp tekrar dener, data URI olarak gönderir (public URL zorunluluğu yok).
async function buildDataUri(localPath) {
  let buffer = fs.readFileSync(localPath);
  if (buffer.length <= MAX_INPUT_BYTES) {
    return `data:image/png;base64,${buffer.toString('base64')}`;
  }

  console.log(`[VideoWorker] Görsel ${(buffer.length / 1024 / 1024).toFixed(1)}MB — 10MB limiti için küçültülüyor`);
  let quality = 85;
  let width = 2500;
  for (let attempt = 0; attempt < 5; attempt++) {
    buffer = await sharp(localPath)
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
    if (buffer.length <= MAX_INPUT_BYTES) break;
    quality -= 15;
    width = Math.round(width * 0.85);
  }
  console.log(`[VideoWorker] Küçültme sonucu: ${(buffer.length / 1024 / 1024).toFixed(1)}MB`);
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

async function callKlingV21(imageDataUri, prompt, duration) {
  const result = await fal.subscribe('fal-ai/kling-video/v2.1/standard/image-to-video', {
    input: {
      image_url: imageDataUri,
      prompt,
      duration: duration >= 8 ? '10' : '5',
      negative_prompt: 'blur, distort, low quality, people, text, scene change, camera pan',
    },
    logs: false,
  });
  return result?.data?.video?.url || result?.video?.url || null;
}

async function callPixverseV45(imageDataUri, prompt, duration) {
  const result = await fal.subscribe('fal-ai/pixverse/v4.5/image-to-video', {
    input: {
      image_url: imageDataUri,
      prompt,
      resolution: '720p',
      duration: duration >= 8 ? '8' : '5',
      negative_prompt: 'blur, distort, low quality, people, text, scene change, camera pan',
    },
    logs: false,
  });
  return result?.data?.video?.url || result?.video?.url || null;
}

// Birincil/fallback model zinciri — tek bir klip üretir, FAL'ın (geçici) CDN URL'ini döner.
async function generateClip(imageDataUri, motionType, duration) {
  const prompt = MOTION_PROMPTS[motionType] || MOTION_PROMPTS.subtle;
  try {
    console.log(`[VideoWorker] [${motionType}] Birincil model deneniyor: kling-video v2.1 standard`);
    const url = await callKlingV21(imageDataUri, prompt, duration);
    if (!url) throw new Error('Kling boş sonuç döndü');
    return { url, modelUsed: 'kling-video-v2.1-standard' };
  } catch (primaryErr) {
    console.warn(`[VideoWorker] [${motionType}] Birincil model başarısız (${primaryErr.message}), fallback: pixverse v4.5`);
    const url = await callPixverseV45(imageDataUri, prompt, duration);
    if (!url) throw new Error('Her iki modelden de video URL alınamadı');
    return { url, modelUsed: 'pixverse-v4.5-720p' };
  }
}

async function downloadToTemp(url, suffix) {
  const fetch = require('node-fetch');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Klip indirilemedi: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = path.join(os.tmpdir(), `clip-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`);
  fs.writeFileSync(tmp, buf);
  return tmp;
}

// Farklı modellerden gelen klipler çözünürlük/codec bakımından uyuşmayabilir —
// hepsini 1280x720'e normalize edip (concat filter, demuxer değil — re-encode
// güvenli) tek dosyada birleştirir. Ses yok (Etsy zaten kaldırıyor).
function concatClips(clipPaths, outputPath) {
  return new Promise((resolve, reject) => {
    if (clipPaths.length === 1) {
      fs.copyFileSync(clipPaths[0], outputPath);
      return resolve();
    }
    const scaleLabels = clipPaths.map((_, i) => `[${i}:v]scale=1280:720,setsar=1[v${i}]`).join('; ');
    const concatIn = clipPaths.map((_, i) => `[v${i}]`).join('');
    const filter = `${scaleLabels}; ${concatIn}concat=n=${clipPaths.length}:v=1:a=0[outv]`;

    const cmd = ffmpeg();
    clipPaths.forEach(p => cmd.input(p));
    cmd.complexFilter(filter).map('[outv]')
      .outputOptions(['-pix_fmt yuv420p'])
      .save(outputPath)
      .on('end', resolve)
      .on('error', reject);
  });
}

async function processReel(imageDataUri, duration) {
  const clipPaths = [];
  const modelsUsed = [];
  for (const motionType of REEL_SEQUENCE) {
    try {
      const { url, modelUsed } = await generateClip(imageDataUri, motionType, duration);
      const localClip = await downloadToTemp(url, '.mp4');
      clipPaths.push(localClip);
      modelsUsed.push(`${motionType}:${modelUsed}`);
    } catch (err) {
      console.warn(`[VideoWorker] [reel] "${motionType}" klibi atlandı: ${err.message}`);
    }
  }
  if (clipPaths.length === 0) {
    throw new Error('Reel için hiçbir klip üretilemedi');
  }

  const outputPath = path.join(os.tmpdir(), `reel-${Date.now()}.mp4`);
  await concatClips(clipPaths, outputPath);
  clipPaths.forEach(p => { try { fs.unlinkSync(p); } catch (_) {} });

  return { localPath: outputPath, modelUsed: modelsUsed.join(', ') };
}

const worker = new Worker('video-generation', async (job) => {
  const { mockupId, workspaceId, motionType = 'subtle', duration = 5, mode = 'single' } = job.data;

  const mockup = await prisma.mockup.findFirst({ where: { id: mockupId } });
  if (!mockup) throw new Error(`Mockup bulunamadı: ${mockupId}`);

  console.log(`[VideoWorker] ▶ mockupId:${mockupId} mode:${mode} motion:${motionType}`);

  let srcLocalPath;
  let reelLocalPath;

  try {
    srcLocalPath = await resolveLocalImagePath(mockup.mockupUrl);
    const imageDataUri = await buildDataUri(srcLocalPath);

    let permanentUrl;
    let modelUsed;

    if (mode === 'reel') {
      const result = await processReel(imageDataUri, duration);
      reelLocalPath = result.localPath;
      modelUsed = result.modelUsed;
      const storagePath = `videos/${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`;
      permanentUrl = await uploadToStorage(reelLocalPath, storagePath);
    } else {
      const { url, modelUsed: single } = await generateClip(imageDataUri, motionType, duration);
      modelUsed = single;
      const storagePath = `videos/${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`;
      permanentUrl = await uploadUrlToStorage(url, storagePath);
    }

    await prisma.mockup.update({
      where: { id: mockupId },
      data: { videoUrl: permanentUrl, videoStatus: 'done', videoModel: modelUsed },
    });

    logNotification(workspaceId, 'success', `Video mockup hazır (${mode === 'reel' ? 'reel' : modelUsed})`, { mockupId, videoUrl: permanentUrl });
    console.log(`[VideoWorker] ✔ mockupId:${mockupId} → done (${modelUsed})`);
  } catch (err) {
    await prisma.mockup.update({
      where: { id: mockupId },
      data: { videoStatus: 'failed' },
    });
    logNotification(workspaceId, 'error', `Video mockup üretimi başarısız: ${err.message}`, { mockupId });
    console.error(`[VideoWorker] ✗ mockupId:${mockupId} → failed: ${err.message}`);
    // Rethrow etmiyoruz — job-level retry istemiyoruz (attempts:1), durum zaten DB'de kayıtlı.
  } finally {
    if (srcLocalPath && srcLocalPath.startsWith(os.tmpdir())) {
      try { fs.unlinkSync(srcLocalPath); } catch (_) {}
    }
    if (reelLocalPath) {
      try { fs.unlinkSync(reelLocalPath); } catch (_) {}
    }
  }
}, {
  connection: redisConnection,
  concurrency: 1,
  lockDuration: 20 * 60_000, // reel modda 3 klip art arda — daha uzun sürebilir
  lockRenewTime: 5 * 60_000,
});

worker.on('error', (err) => {
  console.error('[VideoWorker] Worker error:', err.message);
});

console.log('[VideoWorker] ✔ Dinleniyor → video-generation (concurrency:1)');

module.exports = worker;
