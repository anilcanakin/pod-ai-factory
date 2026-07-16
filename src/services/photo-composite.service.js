'use strict';

const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');
const { loadFontB64, buildTextSvg, mapAlign } = require('./composite-engine.service');

const ASSETS_ROOT = path.join(__dirname, '../../assets');
const REPO_ROOT    = path.join(__dirname, '../../');

// DTF baskı boyutu — sabit, templateConfig'ten bağımsız
const OUTPUT_W = 4500;
const OUTPUT_H = 5400;

// TTF internal name table'dan (name ID 1) — CSS @font-face data-URI/file:// embed
// librsvg'de test edildi, çalışmıyor (bogus font adıyla identical output üretiyor).
// Bunun yerine assets/fonts'u fontconfig dizini olarak kaydedip düz font-family
// eşleşmesiyle çözüyoruz — font-family değeri TTF içindeki GERÇEK isimle eşleşmeli.
const TITLE_FONT_NAME = 'Metal Mania';
const TITLE_FONT_PATH = path.join(ASSETS_ROOT, 'fonts/MetalMania-Regular.ttf');
const CITY_FONT_NAME  = 'Anton';
const CITY_FONT_PATH  = path.join(ASSETS_ROOT, 'fonts/Anton-Regular.ttf');

// fontconfig'e assets/fonts dizinini ekle — process başına bir kez, modül yüklenirken.
// Sistem varsayılan config'ini <include> ile korur, sadece kendi font dizinimizi ekler.
function registerFontsDirOnce() {
  try {
    const fontsDir = path.join(ASSETS_ROOT, 'fonts').replace(/\\/g, '/');
    const cacheDir = path.join(os.tmpdir(), 'pod-ai-fontconfig-cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    const confPath = path.join(os.tmpdir(), 'pod-ai-fontconfig.conf');
    const conf = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <dir>${fontsDir}</dir>
  <cachedir>${cacheDir.replace(/\\/g, '/')}</cachedir>
</fontconfig>`;
    fs.writeFileSync(confPath, conf);
    process.env.FONTCONFIG_FILE = confPath;
  } catch (err) {
    console.warn('[PhotoComposite] fontconfig registration failed, custom fonts may fall back:', err.message);
  }
}
registerFontsDirOnce();

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

// petName uzunsa küçül — uzun isimler maxWidth textLength sıkıştırmasıyla ezilmesin
function getTitleFontSize(petName) {
  const len = String(petName).length;
  if (len < 10) return 280;
  if (len <= 15) return 200;
  return 150;
}

// Grunge scratch/grain dokusu — random noise, düşük alpha ile overlay blend
async function buildGrainOverlay(width, height, opacity) {
  const buf = Buffer.alloc(width * height);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  return sharp(buf, { raw: { width, height, channels: 1 } })
    .toColourspace('srgb')
    .ensureAlpha(opacity)
    .png()
    .toBuffer();
}

// Fotoğrafın alt %20'si şeffaflığa (siyah zemine) fade eder — dest-in alpha mask
function buildBottomFadeMaskSvg(width, height, fadeStart = 0.8) {
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="white" stop-opacity="1"/>
      <stop offset="${fadeStart}" stop-color="white" stop-opacity="1"/>
      <stop offset="1" stop-color="white" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#fade)"/>
</svg>`;
}

/**
 * "<petName> OF FURY" grunge tur posteri — gri/duotone evcil hayvan fotoğrafı,
 * siyah zemin, üstte grunge başlık, altta sabit tur şehri listesi.
 *
 * @param {object} opts
 * @param {string|Buffer} opts.customerPhotoPath - Dosya yolu (repo-relative/absolute) veya Buffer
 * @param {string}         opts.petName
 * @param {object}         [opts.templateConfig]
 * @param {object}         [opts.templateConfig.photoSlot]     - { x, y, width, height, fit }
 * @param {string}         [opts.templateConfig.tintColor]     - Varsayılan '#C8A97A'
 * @param {string[]}       [opts.templateConfig.cities]        - Varsayılan DEFAULT_TOUR_CITIES (baseArtworkUrl varsa kullanılmaz)
 * @param {string}         [opts.templateConfig.baseArtworkUrl] - Verilirse siyah zemin yerine bu görsel kullanılır, şehir listesi metni çizilmez
 * @param {string}         [opts.outputPath] - Verilirse PNG diske de yazılır
 * @returns {Promise<{ buffer: Buffer, outputPath: string|null, width: number, height: number }>}
 */
async function generateFuryTourPoster({ customerPhotoPath, petName, templateConfig = {}, outputPath = null }) {
  if (!customerPhotoPath) throw new Error('customerPhotoPath required');
  if (!petName) throw new Error('petName required');

  const slot   = templateConfig.photoSlot || {};
  const slotW  = slot.width  ?? OUTPUT_W; // tam genişlik, kenardan kenara — border yok
  const slotH  = slot.height ?? Math.round(OUTPUT_H * 0.55);
  const slotX  = slot.x ?? Math.round((OUTPUT_W - slotW) / 2);
  const slotY  = slot.y ?? Math.round(OUTPUT_H * 0.12);
  const tint   = templateConfig.tintColor || DEFAULT_TINT;
  const cities = templateConfig.cities?.length ? templateConfig.cities : DEFAULT_TOUR_CITIES;

  const srcInput = resolvePath(customerPhotoPath);
  if (!Buffer.isBuffer(srcInput) && !fs.existsSync(srcInput)) {
    throw new Error(`customerPhotoPath not found: ${srcInput}`);
  }

  // ── 1: basit center crop — üst %60 (yüz genellikle üstte) ────────────────
  const orientedBuffer = await sharp(srcInput).rotate().toBuffer(); // EXIF auto-orient
  const srcMeta        = await sharp(orientedBuffer).metadata();
  const cropHeight     = Math.max(1, Math.round(srcMeta.height * 0.6));
  const croppedBuffer  = await sharp(orientedBuffer)
    .extract({ left: 0, top: 0, width: srcMeta.width, height: cropHeight })
    .toBuffer();

  // ── 2: gri tonlama + kontrast normalize (linear boost, threshold yok — detay korunur) ─
  const fitted = await sharp(croppedBuffer)
    .resize(slotW, slotH, {
      fit:      slot.fit === 'contain' ? 'contain' : 'cover',
      position: slot.align ? mapAlign(slot.align) : 'centre',
    })
    .grayscale()
    .normalize()
    .linear(1.5, -30)
    .toColourspace('srgb')
    .toBuffer();

  // ── 2b: halftone/grunge grain — küçült+büyüt (posterize blur) ────────────
  const haltoneW = Math.max(1, Math.round(slotW / 4));
  const haltoneH = Math.max(1, Math.round(slotH / 4));
  const stencil  = await sharp(fitted)
    .resize(haltoneW, haltoneH)
    .resize(slotW, slotH)
    .toBuffer();

  // ── 3: bej/krem ton — multiply blend (beyaz alanlar tint alır, siyah kalır) ─
  const tintOverlay = await sharp({
    create: { width: slotW, height: slotH, channels: 3, background: hexToRgb(tint) },
  }).png().toBuffer();

  const tinted = await sharp(stencil)
    .composite([{ input: tintOverlay, blend: 'multiply' }])
    .png()
    .toBuffer();

  // ── 3b: alt %20 siyah zemine fade — dest-in alpha mask ────────────────────
  const fadeMaskSvg = buildBottomFadeMaskSvg(slotW, slotH, 0.8);
  const duotonePhoto = await sharp(tinted)
    .composite([{ input: Buffer.from(fadeMaskSvg), blend: 'dest-in' }])
    .png()
    .toBuffer();

  // ── 4: zemin — baseArtworkUrl varsa onu kullan, yoksa siyah — photoSlot'a yerleştir ─
  const baseArtworkUrl = templateConfig.baseArtworkUrl || null;
  const baseInput = baseArtworkUrl
    ? sharp(resolvePath(baseArtworkUrl)).resize(OUTPUT_W, OUTPUT_H, { fit: 'cover' })
    : sharp({ create: { width: OUTPUT_W, height: OUTPUT_H, channels: 3, background: { r: 0, g: 0, b: 0 } } });

  let chain = baseInput
    .composite([{ input: duotonePhoto, left: Math.round(slotX), top: Math.round(slotY) }]);

  // ── 5: üst başlık — "<petName> OF FURY", grunge font, isim uzunluğuna göre boyut ─
  const titleText = `${String(petName).toUpperCase()} OF FURY`;
  const titleSize = getTitleFontSize(petName);
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

  // ── 6: alt metin — sabit tur şehirleri listesi (baseArtworkUrl zaten içeriyorsa atla) ─
  if (!baseArtworkUrl) {
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
  }

  // ── 7: final PNG — subtle grunge grain zemine dahil tüm postere ──────────
  // Not: chain.composite() ikinci kez çağrılırsa önceki composite'i override eder
  // (merge etmez) — o yüzden grain'den önce mutlaka materialize edip yeniden sarmalıyoruz.
  buf = await chain.png().toBuffer();
  const grain = await buildGrainOverlay(OUTPUT_W, OUTPUT_H, 0.05);
  // 'over' (düz alpha blend) — 'overlay' blend modu bu düşük alpha'da neredeyse görünmez kalıyor
  const outputBuffer = await sharp(buf)
    .composite([{ input: grain, blend: 'over' }])
    .png()
    .toBuffer();

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
