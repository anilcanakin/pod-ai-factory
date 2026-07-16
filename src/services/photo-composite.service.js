'use strict';

const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');
const { loadFontB64, buildTextSvg, mapAlign } = require('./composite-engine.service');

const ASSETS_ROOT = path.join(__dirname, '../../assets');
const REPO_ROOT    = path.join(__dirname, '../../');

// DTF baskı boyutu — sabit, templateConfig'ten bağımsız
const OUTPUT_W = 4500;
const OUTPUT_H = 5400;

const TITLE_FONT_NAME = 'MetalMania';
const TITLE_FONT_PATH = path.join(ASSETS_ROOT, 'fonts/MetalMania-Regular.ttf');
const CITY_FONT_NAME  = 'Anton';
const CITY_FONT_PATH  = path.join(ASSETS_ROOT, 'fonts/Anton-Regular.ttf');

const DEFAULT_TINT = '#C8A97A';
const DEFAULT_TOUR_CITIES = [
  'NEW YORK', 'LONDON', 'BERLIN', 'TOKYO', 'PARIS', 'LOS ANGELES',
];

function hexToRgb(hex) {
  const clean = String(hex).replace('#', '');
  const num   = parseInt(clean, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function resolvePath(p) {
  if (Buffer.isBuffer(p)) return p;
  return path.isAbsolute(p) ? p : path.join(REPO_ROOT, p);
}

/**
 * "<petName> OF FURY" grunge tur posteri — gri/duotone evcil hayvan fotoğrafı,
 * siyah zemin, üstte grunge başlık, altta sabit tur şehri listesi.
 *
 * @param {object} opts
 * @param {string|Buffer} opts.customerPhotoPath - Dosya yolu (repo-relative/absolute) veya Buffer
 * @param {string}         opts.petName
 * @param {object}         [opts.templateConfig]
 * @param {object}         [opts.templateConfig.photoSlot] - { x, y, width, height, fit }
 * @param {string}         [opts.templateConfig.tintColor] - Varsayılan '#C8A97A'
 * @param {string[]}       [opts.templateConfig.cities]    - Varsayılan DEFAULT_TOUR_CITIES
 * @param {string}         [opts.outputPath] - Verilirse PNG diske de yazılır
 * @returns {Promise<{ buffer: Buffer, outputPath: string|null, width: number, height: number }>}
 */
async function generateFuryTourPoster({ customerPhotoPath, petName, templateConfig = {}, outputPath = null }) {
  if (!customerPhotoPath) throw new Error('customerPhotoPath required');
  if (!petName) throw new Error('petName required');

  const slot   = templateConfig.photoSlot || {};
  const slotW  = slot.width  ?? Math.round(OUTPUT_W * 0.75);
  const slotH  = slot.height ?? Math.round(OUTPUT_H * 0.55);
  const slotX  = slot.x ?? Math.round((OUTPUT_W - slotW) / 2);
  const slotY  = slot.y ?? Math.round((OUTPUT_H - slotH) / 2);
  const tint   = templateConfig.tintColor || DEFAULT_TINT;
  const cities = templateConfig.cities?.length ? templateConfig.cities : DEFAULT_TOUR_CITIES;

  const srcInput = resolvePath(customerPhotoPath);
  if (!Buffer.isBuffer(srcInput) && !fs.existsSync(srcInput)) {
    throw new Error(`customerPhotoPath not found: ${srcInput}`);
  }

  // ── 1-2: gri tonlama + kontrast normalize (threshold 128) ────────────────
  const stencil = await sharp(srcInput)
    .rotate() // EXIF auto-orient
    .resize(slotW, slotH, {
      fit:      slot.fit === 'contain' ? 'contain' : 'cover',
      position: slot.align ? mapAlign(slot.align) : 'centre',
    })
    .grayscale()
    .normalize()
    .threshold(128)
    .toColourspace('srgb')
    .toBuffer();

  // ── 3: bej/krem ton — multiply blend (beyaz alanlar tint alır, siyah kalır) ─
  const tintOverlay = await sharp({
    create: { width: slotW, height: slotH, channels: 3, background: hexToRgb(tint) },
  }).png().toBuffer();

  const duotonePhoto = await sharp(stencil)
    .composite([{ input: tintOverlay, blend: 'multiply' }])
    .png()
    .toBuffer();

  // ── 4: siyah zemin üzerine photoSlot koordinatlarına yerleştir ───────────
  let chain = sharp({
    create: { width: OUTPUT_W, height: OUTPUT_H, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).composite([{ input: duotonePhoto, left: Math.round(slotX), top: Math.round(slotY) }]);

  // ── 5: üst başlık — "<petName> OF FURY", grunge font, büyük ──────────────
  const titleText = `${String(petName).toUpperCase()} OF FURY`;
  const titleSize = Math.round(OUTPUT_W * 0.11);
  const titleSvg  = buildTextSvg({
    canvasW: OUTPUT_W,
    canvasH: OUTPUT_H,
    layer: {
      x: OUTPUT_W / 2,
      y: Math.round(slotY * 0.6),
      font: TITLE_FONT_NAME,
      size: titleSize,
      color: tint,
      align: 'center',
      maxWidth: Math.round(OUTPUT_W * 0.9),
    },
    text: titleText,
    fontB64: loadFontB64(TITLE_FONT_PATH),
  });

  let buf = await chain.png().toBuffer();
  chain = sharp(buf).composite([{ input: Buffer.from(titleSvg), blend: 'over' }]);

  // ── 6: alt metin — sabit tur şehirleri listesi ────────────────────────────
  const citySize = Math.round(OUTPUT_W * 0.028);
  const cityY    = slotY + slotH + Math.round((OUTPUT_H - (slotY + slotH)) * 0.45);
  const citySvg  = buildTextSvg({
    canvasW: OUTPUT_W,
    canvasH: OUTPUT_H,
    layer: {
      x: OUTPUT_W / 2,
      y: cityY,
      font: CITY_FONT_NAME,
      size: citySize,
      color: '#FFFFFF',
      align: 'center',
      maxWidth: Math.round(OUTPUT_W * 0.85),
    },
    text: cities.join('   •   '),
    fontB64: loadFontB64(CITY_FONT_PATH),
  });

  buf = await chain.png().toBuffer();
  chain = sharp(buf).composite([{ input: Buffer.from(citySvg), blend: 'over' }]);

  // ── 7: final PNG ───────────────────────────────────────────────────────────
  const outputBuffer = await chain.png().toBuffer();

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, outputBuffer);
  }

  return { buffer: outputBuffer, outputPath, width: OUTPUT_W, height: OUTPUT_H };
}

module.exports = {
  OUTPUT_W,
  OUTPUT_H,
  DEFAULT_TINT,
  DEFAULT_TOUR_CITIES,
  generateFuryTourPoster,
};
