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
const DEFAULT_SUBTITLE = "WORLD TOUR '94";
const DEFAULT_TOUR_CITIES = [
  'NEW YORK', 'LONDON', 'BERLIN', 'TOKYO', 'PARIS', 'LOS ANGELES',
];
const CITIES_PER_ROW = 3;

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

// Fotoğrafın alt kenarı şeffaflığa (siyah zemine) fade eder — dest-in alpha mask
function buildBottomFadeMaskSvg(width, height, fadeStart) {
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

// Fotoğrafın sol/sağ kenarları şeffaflığa fade eder — dest-in alpha mask
function buildSideFadeMaskSvg(width, height, fadePercent) {
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="white" stop-opacity="0"/>
      <stop offset="${fadePercent}" stop-color="white" stop-opacity="1"/>
      <stop offset="${1 - fadePercent}" stop-color="white" stop-opacity="1"/>
      <stop offset="1" stop-color="white" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#fade)"/>
</svg>`;
}

/**
 * "<petName> OF FURY" grunge tur posteri — gri/duotone evcil hayvan fotoğrafı.
 *
 * İki mod:
 *  - Shell modu (templateConfig.baseArtworkUrl verilirse): başlık/altyazı/şehir
 *    listesi zaten şablon görselinin içine gömülü — sadece fotoğraf işlenip
 *    şablonun boş alanına yerleştirilir, hiçbir metin ÇİZİLMEZ. photoSlot
 *    oranları (0..1) şablonun KENDİ native px boyutuna göredir, contain-fit
 *    ile OUTPUT_W×OUTPUT_H tuvaline ölçeklenip offsetlenir (şablonun kendi
 *    en-boy oranı bozulmadan/kırpılmadan).
 *  - Poster modu (baseArtworkUrl yoksa): siyah zemin + üstte grunge başlık +
 *    altta "WORLD TOUR '94" + çok satırlı şehir listesi bu fonksiyon çizer,
 *    photoSlot değerleri OUTPUT_W×OUTPUT_H tuvaline göre MUTLAK px'tir.
 *
 * @param {object} opts
 * @param {string|Buffer} opts.customerPhotoPath - Dosya yolu (repo-relative/absolute) veya Buffer
 * @param {string}         opts.petName
 * @param {object}         [opts.templateConfig]
 * @param {object}         [opts.templateConfig.photoSlot]     - Poster modda mutlak px { x,y,width,height,fit }; shell modda oran (0..1) { x,y,width,height,fit }
 * @param {string}         [opts.templateConfig.tintColor]     - Varsayılan '#C8A97A'
 * @param {string}         [opts.templateConfig.subtitle]      - Varsayılan "WORLD TOUR '94" (yalnızca poster modda)
 * @param {string[]}       [opts.templateConfig.cities]        - Varsayılan DEFAULT_TOUR_CITIES (yalnızca poster modda)
 * @param {string}         [opts.templateConfig.baseArtworkUrl] - Verilirse shell moduna geçilir — metin çizilmez, sadece foto yerleştirilir
 * @param {string}         [opts.outputPath] - Verilirse PNG diske de yazılır
 * @returns {Promise<{ buffer: Buffer, outputPath: string|null, width: number, height: number }>}
 */
async function generateFuryTourPoster({ customerPhotoPath, petName, templateConfig = {}, outputPath = null }) {
  if (!customerPhotoPath) throw new Error('customerPhotoPath required');
  if (!petName) throw new Error('petName required');

  const slot          = templateConfig.photoSlot || {};
  const tint          = templateConfig.tintColor || DEFAULT_TINT;
  const baseArtworkUrl = templateConfig.baseArtworkUrl || null;
  const isShellMode   = !!baseArtworkUrl;

  const srcInput = resolvePath(customerPhotoPath);
  if (!Buffer.isBuffer(srcInput) && !fs.existsSync(srcInput)) {
    throw new Error(`customerPhotoPath not found: ${srcInput}`);
  }

  // ── zemin + photoSlot geometrisi ──────────────────────────────────────────
  let slotX, slotY, slotW, slotH, baseInput;

  if (isShellMode) {
    const shellPath = resolvePath(baseArtworkUrl);
    const shellMeta = await sharp(shellPath).metadata();
    const shellW    = shellMeta.width;
    const shellH    = shellMeta.height;

    // contain-fit — şablonun kendi en-boy oranı OUTPUT_W×OUTPUT_H'ten farklı
    // olabilir (bu şablon 592×1136), 'cover' kullanırsak kırpılıp bozulur.
    const containScale = Math.min(OUTPUT_W / shellW, OUTPUT_H / shellH);
    const containW = Math.round(shellW * containScale);
    const containH = Math.round(shellH * containScale);
    const offsetX  = Math.round((OUTPUT_W - containW) / 2);
    const offsetY  = Math.round((OUTPUT_H - containH) / 2);

    // photoSlot burada ORAN (0..1), şablonun native boyutuna göre
    const ratioX = slot.x ?? 0;
    const ratioY = slot.y ?? 0;
    const ratioW = slot.width  ?? 1;
    const ratioH = slot.height ?? 1;

    slotX = offsetX + Math.round(ratioX * containW);
    slotY = offsetY + Math.round(ratioY * containH);
    slotW = Math.round(ratioW * containW);
    slotH = Math.round(ratioH * containH);

    // Not: composite() ikinci kez çağrılırsa öncekini override eder (merge etmez) —
    // bu yüzden shell'i tuvale materialize edip TEK composite ile devam ediyoruz;
    // aksi halde birazdan eklenecek foto composite'i şablonu sessizce silerdi.
    const shellResized = await sharp(shellPath).resize(containW, containH).toBuffer();
    const canvasWithShell = await sharp({
      create: { width: OUTPUT_W, height: OUTPUT_H, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).composite([{ input: shellResized, left: offsetX, top: offsetY }]).png().toBuffer();
    baseInput = sharp(canvasWithShell);
  } else {
    // Poster modu — mutlak px, varsayılanlar
    slotW = slot.width  ?? Math.round(OUTPUT_W * 0.85);
    slotH = slot.height ?? Math.round(OUTPUT_H * 0.55);
    slotX = slot.x ?? Math.round((OUTPUT_W - slotW) / 2);
    slotY = slot.y ?? Math.round(OUTPUT_H * 0.15);
    baseInput = sharp({ create: { width: OUTPUT_W, height: OUTPUT_H, channels: 3, background: { r: 0, g: 0, b: 0 } } });
  }

  // ── 1: crop — poster modda yüz odaklı üst %75, shell modda düz cover-fit ──
  const orientedBuffer = await sharp(srcInput).rotate().toBuffer(); // EXIF auto-orient
  let cropSourceBuffer = orientedBuffer;
  if (!isShellMode) {
    const srcMeta    = await sharp(orientedBuffer).metadata();
    const cropHeight = Math.max(1, Math.round(srcMeta.height * 0.75));
    cropSourceBuffer = await sharp(orientedBuffer)
      .extract({ left: 0, top: 0, width: srcMeta.width, height: cropHeight })
      .toBuffer();
  }

  // ── 2: gri tonlama + kontrast normalize (threshold yok — detay korunur) ──
  const fitted = await sharp(cropSourceBuffer)
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

  let duotonePhoto = await sharp(stencil)
    .composite([{ input: tintOverlay, blend: 'multiply' }])
    .png()
    .toBuffer();

  // ── 3b: alt/yan fade — sadece poster modda (shell modda şablonun kendi
  // dikdörtgen çerçevesi zaten kenar sınırı, fade gereksiz/yanlış görünür) ──
  if (!isShellMode) {
    const bottomFadeSvg = buildBottomFadeMaskSvg(slotW, slotH, 0.85);
    const bottomFaded = await sharp(duotonePhoto)
      .composite([{ input: Buffer.from(bottomFadeSvg), blend: 'dest-in' }])
      .png()
      .toBuffer();

    const sideFadeSvg = buildSideFadeMaskSvg(slotW, slotH, 0.05);
    duotonePhoto = await sharp(bottomFaded)
      .composite([{ input: Buffer.from(sideFadeSvg), blend: 'dest-in' }])
      .png()
      .toBuffer();
  }

  // ── 4: fotoğrafı zemine (siyah tuval veya şablon) yerleştir ───────────────
  let chain = baseInput
    .composite([{ input: duotonePhoto, left: Math.round(slotX), top: Math.round(slotY) }]);

  // ── 5-6: başlık + altyazı + şehir listesi — YALNIZCA poster modda ────────
  // Shell modda tüm metin şablon görselinin içine gömülü, burada çizilmez.
  if (!isShellMode) {
    const titleText = `${String(petName).toUpperCase()} OF FURY`;
    const titleSize = getTitleFontSize(petName);
    const titleSvg  = buildTextSvg({
      canvasW: OUTPUT_W,
      canvasH: OUTPUT_H,
      layer: {
        x: OUTPUT_W / 2,
        y: Math.round(OUTPUT_H * 0.08),
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

    const subtitle = templateConfig.subtitle ?? DEFAULT_SUBTITLE;
    const cities   = templateConfig.cities?.length ? templateConfig.cities : DEFAULT_TOUR_CITIES;
    const cityFontB64 = loadFontB64(CITY_FONT_PATH);

    const subtitleSize = Math.round(OUTPUT_W * 0.036);
    const subtitleY     = slotY + slotH + Math.round(OUTPUT_H * 0.03);
    const subtitleSvg  = buildTextSvg({
      canvasW: OUTPUT_W,
      canvasH: OUTPUT_H,
      layer: {
        x: OUTPUT_W / 2,
        y: subtitleY,
        font: CITY_FONT_NAME,
        size: subtitleSize,
        color: tint,
        align: 'center',
        maxWidth: Math.round(OUTPUT_W * 0.8),
      },
      text: subtitle,
      fontB64: cityFontB64,
    });

    buf = await chain.png().toBuffer();
    chain = sharp(buf).composite([{ input: Buffer.from(subtitleSvg), blend: 'over' }]);

    // Şehirler CITIES_PER_ROW'luk satırlara bölünür, her satır ayrı çizilir
    const citySize   = Math.round(OUTPUT_W * 0.028);
    const rowGap     = Math.round(citySize * 1.5);
    const citiesY0   = Math.round(OUTPUT_H * 0.82);
    const rows = [];
    for (let i = 0; i < cities.length; i += CITIES_PER_ROW) {
      rows.push(cities.slice(i, i + CITIES_PER_ROW));
    }

    for (let r = 0; r < rows.length; r++) {
      const citySvg = buildTextSvg({
        canvasW: OUTPUT_W,
        canvasH: OUTPUT_H,
        layer: {
          x: OUTPUT_W / 2,
          y: citiesY0 + r * rowGap,
          font: CITY_FONT_NAME,
          size: citySize,
          color: tint,
          align: 'center',
          maxWidth: Math.round(OUTPUT_W * 0.85),
        },
        text: rows[r].join('   •   '),
        fontB64: cityFontB64,
      });

      buf = await chain.png().toBuffer();
      chain = sharp(buf).composite([{ input: Buffer.from(citySvg), blend: 'over' }]);
    }
  }

  // ── 7: final PNG — subtle grunge grain zemine dahil tüm postere ──────────
  // Not: chain.composite() ikinci kez çağrılırsa önceki composite'i override eder
  // (merge etmez) — o yüzden grain'den önce mutlaka materialize edip yeniden sarmalıyoruz.
  const preGrainBuf = await chain.png().toBuffer();
  const grain = await buildGrainOverlay(OUTPUT_W, OUTPUT_H, 0.03);
  // 'over' (düz alpha blend) — 'overlay' blend modu bu düşük alpha'da neredeyse görünmez kalıyor
  const outputBuffer = await sharp(preGrainBuf)
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
