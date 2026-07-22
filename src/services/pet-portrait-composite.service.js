'use strict';

const sharp  = require('sharp');
const path   = require('path');
const fs     = require('fs');
const fetch  = require('node-fetch');
const secretsService = require('./secrets.service');
const { loadFontB64, buildTextSvg, FONT_REGISTRY } = require('./composite-engine.service');

const REPO_ROOT = path.join(__dirname, '../../');

// Doğrulanmış fal.ai Playground pipeline'ı — bkz. görev notu. 'openai/gpt-image-2/edit'
// (düz 'fal-ai/gpt-image-2' değil) kullanılıyor çünkü photo-composite.service.js'de zaten
// doğrulandığı gibi düz endpoint text-to-image'dir ve girdi görsellerini yok sayar; edit
// varyantı image_urls'i gerçekten referans alır.
const GPT_IMAGE_EDIT_MODEL = 'openai/gpt-image-2/edit';

const COMBINE_PROMPT = "Completely re-render both subjects as if photographed together by the "
  + 'same camera, in the same physical space, under one single consistent light source. Do not '
  + 'simply color-match or overlay the existing photos — reimagine the scene as one unified '
  + "photograph, adjusting pose, angle, and perspective so both subjects share the same camera "
  + "viewpoint. Keep both subjects' features and likeness clearly recognizable. Pose: the person "
  + 'embracing/holding the pet closely.'; // v1: poz sabit (embrace) — müşteriye poz seçimi sunulmuyor

const STYLIZE_PROMPT = 'Transform this photo into a vintage sepia engraving-style portrait, fine '
  + "halftone texture, warm cream and black tones, keep both subjects' likeness clearly "
  + 'recognizable, no text, elegant and timeless illustration style, print-ready';

const RMBG_MODEL          = 'fal-ai/birefnet/v2';
const RMBG_FALLBACK_MODEL = 'fal-ai/bria/background/remove';

function resolvePath(p) {
  if (Buffer.isBuffer(p)) return p;
  return path.isAbsolute(p) ? p : path.join(REPO_ROOT, p);
}

async function toJpegDataUrl(input, maxDim = 1600) {
  const src = resolvePath(input);
  const buf = Buffer.isBuffer(src) ? src : fs.readFileSync(src);
  const oriented = await sharp(buf).rotate().toBuffer(); // EXIF auto-orient
  const jpeg = await sharp(oriented)
    .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

async function callGptImageEdit(imageUrls, prompt, workspaceId) {
  const falKey = await secretsService.getKey('fal', workspaceId, true);
  const url = `https://fal.run/${GPT_IMAGE_EDIT_MODEL}`;

  // 2 girdi görselli (birleştirme) çağrılar 1 girdili (stilizasyon) çağrılardan gözle
  // görülür yavaş — tek görselde doğrulanmış 180s'lik pay burada aşılabiliyor, 5dk'ya çıkarıldı.
  const TIMEOUT_MS = 300000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const tStart = Date.now();

  let response;
  try {
    response = await fetch(url, {
      method:  'POST',
      headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        image_urls:     imageUrls,
        image_size:     'square_hd',
        quality:        'high',
        num_images:     1,
        output_format:  'png',
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`GPT Image 2 edit timed out (${TIMEOUT_MS / 1000}s)`);
    throw err;
  } finally {
    clearTimeout(timeout);
    console.log(`[PetPortrait] fal.run ${GPT_IMAGE_EDIT_MODEL} (${imageUrls.length} img) elapsed=${Date.now() - tStart}ms`);
  }

  const responseText = await response.text();
  let data = {};
  try { data = JSON.parse(responseText); } catch { data = {}; }

  if (!response.ok) {
    const errMsg = data.detail || data.message || data.error || responseText;
    const errStr = typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg);
    throw new Error(`GPT Image 2 edit HTTP ${response.status}: ${errStr.substring(0, 500)}`);
  }

  const imageUrl = data.images?.[0]?.url || data.image?.url || data.output?.[0]?.url || null;
  if (!imageUrl) throw new Error('GPT Image 2 edit: response içinde image URL yok');
  return imageUrl;
}

/**
 * Adım 1 — Birleştirme: kişi + evcil hayvan fotoğrafını tek, gerçekçi (henüz stilize
 * edilmemiş) birleşik sahneye dönüştürür.
 * @param {string|Buffer} personPhotoInput
 * @param {string|Buffer} petPhotoInput
 * @param {string|null}   workspaceId
 * @returns {Promise<{ url: string }>} fal CDN URL — sonraki adıma doğrudan verilir
 */
async function combineSubjects(personPhotoInput, petPhotoInput, workspaceId = null) {
  const personDataUrl = await toJpegDataUrl(personPhotoInput);
  const petDataUrl    = await toJpegDataUrl(petPhotoInput);
  const imageUrl = await callGptImageEdit([personDataUrl, petDataUrl], COMBINE_PROMPT, workspaceId);
  console.log(`[PetPortrait] Adım 1 (birleştirme) ✓ ${imageUrl}`);
  return { url: imageUrl };
}

/**
 * Adım 2 — Stilizasyon: birleşik fotoğrafı sepya/halftone gravür portreye dönüştürür.
 * @param {string} combinedImageUrl - Adım 1 çıktısı (fal CDN URL)
 * @param {string|null} workspaceId
 * @returns {Promise<{ url: string }>}
 */
async function stylizePortrait(combinedImageUrl, workspaceId = null) {
  const imageUrl = await callGptImageEdit([combinedImageUrl], STYLIZE_PROMPT, workspaceId);
  console.log(`[PetPortrait] Adım 2 (stilizasyon) ✓ ${imageUrl}`);
  return { url: imageUrl };
}

async function callBgRemoveModel(modelId, payload, falKey) {
  const url = `https://fal.run/${modelId}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000); // 2dk

  let response;
  try {
    response = await fetch(url, {
      method:  'POST',
      headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const responseText = await response.text();
  let data = {};
  try { data = JSON.parse(responseText); } catch { data = {}; }

  if (!response.ok) {
    const errMsg = data.detail || data.message || data.error || responseText;
    const errStr = typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg);
    throw new Error(`${modelId} HTTP ${response.status}: ${errStr.substring(0, 500)}`);
  }

  const outputUrl = data.image?.url || data.images?.[0]?.url || data.output?.[0]?.url || null;
  if (!outputUrl) throw new Error(`${modelId}: response içinde image URL yok`);
  return outputUrl;
}

/**
 * Adım 3 — Arka plan kaldırma: stilize portreyi şeffaf PNG'ye çevirir.
 * Birincil: fal-ai/birefnet/v2 (model: "Portrait", refine_foreground: true).
 * Kalite yetersizse fal-ai/bria/background/remove'e düşer.
 * @param {string} styledImageUrl - Adım 2 çıktısı (fal CDN URL)
 * @param {string|null} workspaceId
 * @returns {Promise<{ url: string }>}
 */
async function removeBackgroundPortrait(styledImageUrl, workspaceId = null) {
  const falKey = await secretsService.getKey('fal', workspaceId, true);

  try {
    const outputUrl = await callBgRemoveModel(RMBG_MODEL, {
      image_url:          styledImageUrl,
      model:               'Portrait',
      refine_foreground:   true,
      output_format:       'png',
    }, falKey);
    console.log(`[PetPortrait] Adım 3 (BG kaldırma, ${RMBG_MODEL}) ✓ ${outputUrl}`);
    return { url: outputUrl };
  } catch (err) {
    console.warn(`[PetPortrait] ${RMBG_MODEL} başarısız (${err.message}), ${RMBG_FALLBACK_MODEL} deneniyor...`);
    const outputUrl = await callBgRemoveModel(RMBG_FALLBACK_MODEL, { image_url: styledImageUrl }, falKey);
    console.log(`[PetPortrait] Adım 3 (BG kaldırma, fallback ${RMBG_FALLBACK_MODEL}) ✓ ${outputUrl}`);
    return { url: outputUrl };
  }
}

/**
 * Adım 4 — Kompozisyon (AI DEĞİL, Sharp): şeffaf portreyi şablon tuvaline yerleştirir,
 * kontrast normalizasyonu uygular, varsa isim/tarih metnini SVG ile basar.
 * @param {Buffer} transparentPortraitBuffer - Adım 3 çıktısı (indirilmiş, şeffaf PNG)
 * @param {object} template - PhotoTemplate satırı (printWidthPx, printHeightPx, textLayers)
 * @param {object} [variables] - textLayers.key'lerine karşılık gelen değerler (örn. { name, date })
 * @returns {Promise<Buffer>}
 */
async function composeOntoTemplate(transparentPortraitBuffer, template, variables = {}) {
  const canvasW = template.printWidthPx;
  const canvasH = template.printHeightPx;

  // TODO: Kontrast/seviye normalizasyon parametreleri kesinleşmedi (bkz. görev notu —
  // "kesin parametreler belirlenmedi"). Şimdilik makul varsayılan: Sharp .normalize()
  // (histogram germe) + hafif .linear() kontrast artışı. Gerçek sipariş verisiyle
  // ayarlanacak.
  const normalized = await sharp(transparentPortraitBuffer)
    .normalize()
    .linear(1.08, -6)
    .png()
    .toBuffer();

  const meta = await sharp(normalized).metadata();
  const scale = Math.min(canvasW / meta.width, canvasH / meta.height);
  const fitW = Math.max(1, Math.round(meta.width * scale));
  const fitH = Math.max(1, Math.round(meta.height * scale));
  const offsetX = Math.round((canvasW - fitW) / 2);
  const offsetY = Math.round((canvasH - fitH) / 2);

  const fitted = await sharp(normalized).resize(fitW, fitH).png().toBuffer();

  let chain = sharp({
    create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: fitted, left: offsetX, top: offsetY }]);

  // İsim/tarih overlay — AI'ya yazdırılmıyor, template.textLayers tanımlıysa Sharp/SVG
  // ile düz metin basılıyor (composite-engine.service.js'deki buildTextSvg pattern'i).
  const layers = Array.isArray(template.textLayers) ? template.textLayers : [];
  for (const layer of layers) {
    const rawValue = variables[layer.key];
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;

    let text = String(rawValue);
    if (layer.transform === 'uppercase') text = text.toUpperCase();
    if (layer.transform === 'lowercase') text = text.toLowerCase();

    const fontPath = FONT_REGISTRY[layer.font];
    if (!fontPath) {
      console.warn(`[PetPortrait] Bilinmeyen font "${layer.font}" — katman atlandı`);
      continue;
    }
    const fontB64 = loadFontB64(fontPath);
    const svg = buildTextSvg({ canvasW, canvasH, layer, text, fontB64 });

    const buf = await chain.png().toBuffer();
    chain = sharp(buf).composite([{ input: Buffer.from(svg), blend: 'over' }]);
  }

  // TODO (v1 kapsamı dışı — kod yazılmadı, bilgi notu):
  //  - Grup fotoğrafı validasyonu hiç test edilmedi
  //  - Şapka/güneş gözlüğü/yüzü kapatan objeler test edilmedi

  // Gravür/halftone stilizasyon yüksek-frekanslı doku üretiyor — PNG lossless bunu
  // neredeyse hiç sıkıştıramıyor (43MB+ çıktı). Şeffaflık sadece aspect-fit letterbox
  // kenarlarında var (offsetX/offsetY boşlukları); beyazla flatten edip JPEG'e
  // dönüştürmek görsel kaybı ihmal edilebilir düzeyde tutarken boyutu drastik düşürüyor.
  return chain
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/**
 * 4 adımı sırayla çalıştıran orkestrasyon fonksiyonu.
 * @param {object} opts
 * @param {string|Buffer} opts.personPhotoPath
 * @param {string|Buffer} opts.petPhotoPath
 * @param {object}         opts.template        - PhotoTemplate satırı
 * @param {object}         [opts.variables]      - textLayers overlay değerleri
 * @param {string|null}    [opts.workspaceId]
 * @param {string|null}    [opts.outputPath]     - verilirse PNG diske de yazılır
 * @returns {Promise<{ buffer: Buffer, outputPath: string|null, width: number, height: number, steps: object }>}
 */
async function generatePetPortrait({
  personPhotoPath, petPhotoPath, template, variables = {},
  workspaceId = null, outputPath = null,
}) {
  if (!personPhotoPath) throw new Error('personPhotoPath required');
  if (!petPhotoPath) throw new Error('petPhotoPath required');
  if (!template) throw new Error('template required');

  const step1 = await combineSubjects(personPhotoPath, petPhotoPath, workspaceId);
  const step2 = await stylizePortrait(step1.url, workspaceId);
  const step3 = await removeBackgroundPortrait(step2.url, workspaceId);

  const transparentRes = await fetch(step3.url);
  if (!transparentRes.ok) throw new Error(`Adım 3 çıktısı indirilemedi: HTTP ${transparentRes.status}`);
  const transparentBuffer = Buffer.from(await transparentRes.arrayBuffer());

  const finalBuffer = await composeOntoTemplate(transparentBuffer, template, variables);

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, finalBuffer);
  }

  return {
    buffer: finalBuffer,
    outputPath,
    width:  template.printWidthPx,
    height: template.printHeightPx,
    steps: {
      combinedUrl:    step1.url,
      stylizedUrl:    step2.url,
      transparentUrl: step3.url,
    },
  };
}

module.exports = {
  combineSubjects,
  stylizePortrait,
  removeBackgroundPortrait,
  composeOntoTemplate,
  generatePetPortrait,
};
