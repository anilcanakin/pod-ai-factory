'use strict';

const sharp = require('../lib/sharp-safe');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');
const fetch = require('node-fetch');
const { loadFontB64, buildTextSvg, mapAlign } = require('./composite-engine.service');
const secretsService = require('./secrets.service');
const falProvider     = require('./providers/fal.provider');

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

function mixRgb(c1, c2, t) {
  return {
    r: c1.r + (c2.r - c1.r) * t,
    g: c1.g + (c2.g - c1.g) * t,
    b: c1.b + (c2.b - c1.b) * t,
  };
}

// BiRefNet'in gerçek alpha'sını koruyup RGB'yi tint renginin koyu/açık
// varyasyonları arasında bir duotone gradyanına map eder — düz gri yerine
// sıcak bej/altın ton. Gravür/pencil-sketch AI çıktısı zaten yeterli detay
// ve kontrastta (bkz. output-ai-raw.png testi) — posterize/gamma EKLENMEZ,
// 256 seviyelik luminance'ın tamamı korunarak düz lineer renk haritalanır.
async function applyRealAlphaDuotone(grayBuffer, tintHex) {
  const { data, info } = await sharp(grayBuffer)
    .ensureAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const tint  = hexToRgb(tintHex);
  const dark  = mixRgb(tint, { r: 0, g: 0, b: 0 }, 0.55);   // koyu bej
  const light = mixRgb(tint, { r: 255, g: 255, b: 255 }, 0.55); // açık krem

  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const lum   = data[o]; // grayscale — R kanalı luminance'ı taşır
    const alpha = data[o + 3];
    const v = lum / 255; // ham luminance, posterize/gamma yok

    const oo = i * 4;
    out[oo]     = Math.round(dark.r + (light.r - dark.r) * v);
    out[oo + 1] = Math.round(dark.g + (light.g - dark.g) * v);
    out[oo + 2] = Math.round(dark.b + (light.b - dark.b) * v);
    out[oo + 3] = alpha;
  }

  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
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

// Gerçek yarım-ton (halftone) nokta deseni — klasik ekran baskı efekti.
// Blur/downsample-upsample "sahte halftone" yerine: gri tonlu görseli
// cellSize×cellSize hücrelere böler, her hücrenin ortalama koyuluğuna göre
// orantılı yarıçapta bir daire çizer (koyu = büyük daire). SVG'de tüm daireler
// tek seferde çizilip rasterize edilir.
async function buildHalftoneDots(grayBuffer, width, height, cellSize = 9) {
  const cols = Math.max(1, Math.round(width / cellSize));
  const rows = Math.max(1, Math.round(height / cellSize));

  // Her hücre için ortalama parlaklığı almak üzere cols×rows'a küçült
  const { data } = await sharp(grayBuffer)
    .resize(cols, rows, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const maxR = cellSize * 0.68; // en koyu hücrede komşu daireler hafif örtüşsün, düz siyah hissi versin
  let circles = '';
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const lum = data[ry * cols + rx]; // grayscale → 1 kanal
      const darkness = 1 - lum / 255;
      const r = darkness * maxR;
      if (r < 0.4) continue;
      const cx = (rx + 0.5) * cellSize;
      const cy = (ry + 0.5) * cellSize;
      circles += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}"/>`;
    }
  }

  const svg = `<svg width="${cols * cellSize}" height="${rows * cellSize}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="white"/>
  <g fill="black">${circles}</g>
</svg>`;

  return sharp(Buffer.from(svg)).resize(width, height).toColourspace('srgb').png().toBuffer();
}

// "Kumaşa gömülü" efekti (Kittl'daki Foto Filtre → Remove Color → Intensity
// akışının yaklaşımı) — opak bej blend yerine, piksel ne kadar koyuysa o kadar
// şeffaflaştırılır; koyu renk tişört üzerine composite edilince tasarım
// kumaşın dokusundan çıkmış/baskısı zayıflamış gibi görünür. Parlak alanlar
// opak kalır (tam görünür), en koyu alanlar minAlpha=0 varsayılanıyla tamamen
// şeffaflaşır (kutu/çerçeve hissi kalmasın diye) — iz bırakmak istenirse minAlpha>0 verilir.
//
// Not: Kittl'ın kendi "Intensity" formülü kapalı kaynak — burada intensity'yi
// bir gamma eğrisi üsse çeviriyoruz (intensity=28 → gamma≈2.4). Yüksek
// intensity = koyu tonlar daha agresif şeffaflaşır (eğri daha dik).
async function applyFabricBlendEffect(imageBuffer, options = {}) {
  const { intensity = 28, minAlpha = 0 } = options;

  const { data, info } = await sharp(imageBuffer)
    .grayscale()
    .normalize()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const gamma  = 1 + intensity / 20;
  const minA   = Math.round(minAlpha * 255);
  const rgba   = Buffer.alloc(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const lum    = data[i * channels]; // grayscale — tek kanal
    const curved = Math.pow(lum / 255, gamma);
    const alpha  = Math.round(minA + (255 - minA) * curved);

    const o = i * 4;
    rgba[o]     = lum;
    rgba[o + 1] = lum;
    rgba[o + 2] = lum;
    rgba[o + 3] = alpha;
  }

  // Opak→şeffaf geçişi sert kalıyor (minAlpha=0 ile tam kenar) — sadece alpha
  // kanalına gaussian blur uygulayıp RGB'yi bozmadan geçişi yumuşatıyoruz,
  // "kutu kenarı" hissi böyle erir.
  const rgbaSharp   = sharp(rgba, { raw: { width, height, channels: 4 } });
  const blurredAlpha = await rgbaSharp.clone().extractChannel(3).blur(4).raw().toBuffer();
  const rgbOnly       = await rgbaSharp.clone().removeAlpha().raw().toBuffer();

  return sharp(rgbOnly, { raw: { width, height, channels: 3 } })
    .joinChannel(blurredAlpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
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

// Şablonun kendi photoSlot kutusu şablon SANATININ İÇİNDE düz/flat koyu bir
// dikdörtgen olarak çizilmiş (pet-fury-shell.png'de luminance≈10), etraftaki
// grunge dokusu ise gürültülü (luminance≈30-55) — kedi kutunun her noktasını
// kaplamadığında (köşeler, boşluklar) bu düz-vs-dokulu fark "kutu kenarı" gibi
// görünüyor. Kedi compositelenmeden ÖNCE kutu alanına, çevredeki grunge ile
// aynı luminance aralığında gürültü basıp flat alanı dokuyla eşleştiriyoruz.
async function buildBoxGrungeMatch(width, height) {
  const buf = Buffer.alloc(width * height);
  for (let i = 0; i < buf.length; i++) buf[i] = 20 + Math.floor(Math.random() * 35); // ~20-55, çevre grunge aralığı
  return sharp(buf, { raw: { width, height, channels: 1 } })
    .toColourspace('srgb')
    .ensureAlpha(0.85)
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

// ── KATMAN 1: AI Fotoğraf Dönüşümü (fal-ai/gpt-image-2, image-to-image) ────────
const AI_TRANSFORM_MODEL  = 'openai/gpt-image-2/edit'; // edit/i2i varyantı — image_urls'i gerçekten referans alır, düz 'fal-ai/gpt-image-2' text-to-image'dir ve girdi görselini yok sayar
const AI_TRANSFORM_PROMPT = 'Transform this photo into a fine-line engraving portrait, '
  + 'detailed pencil sketch style with cross-hatching technique, realistic tonal gradients '
  + 'through line density (not dots), clean hand-drawn illustration look, black ink on '
  + "transparent background, no halftone pattern, no color, keep the subject's likeness and "
  + 'pose recognizable, high detail in fur/hair texture, no text, no lettering, isolated '
  + 'portrait, no background elements';

// customerPhoto → stilize illüstrasyon buffer. Hata durumunda çağıran taraf (generateFuryTourPoster)
// Sharp-only fallback'e düşer — burada fırlatılan hata orada yakalanır.
async function transformPhotoWithAI(photoBuffer, workspaceId = null, useRealBgRemove = true) {
  const falKey = await secretsService.getKey('fal', workspaceId, true);
  // fal 25MB base64 dosya limiti — kaynak fotoğraf (gerçek kamera/stok fotoğrafı) çok
  // büyük olabilir, uzun kenarı 1600px'e indirip jpeg'e çeviriyoruz (stil transferi için yeterli).
  const jpegBuffer = await sharp(photoBuffer)
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
  const dataUrl = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;

  const crypto = require('crypto');
  const reqId = Math.random().toString(36).slice(2, 8);
  const inputHash = crypto.createHash('sha256').update(jpegBuffer).digest('hex').slice(0, 12);
  const tStart = Date.now();
  console.log(`[DEBUG-AI][${reqId}] request start t=${new Date(tStart).toISOString()} inputJpegHash=${inputHash} inputJpegBytes=${jpegBuffer.length}`);

  const url = `https://fal.run/${AI_TRANSFORM_MODEL}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000); // 3 dk — GPT-Image-2 yavaş, fal.provider.js ile aynı süre

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: AI_TRANSFORM_PROMPT,
        image_urls: [dataUrl],
        image_size: 'square_hd',
        quality: 'high',
        num_images: 1,
        output_format: 'png',
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('AI transform timed out (180s)');
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  const elapsedMs = Date.now() - tStart;
  console.log(`[DEBUG-AI][${reqId}] HTTP response status=${response.status} elapsed=${elapsedMs}ms`);

  const responseText = await response.text();
  let data = {};
  try { data = JSON.parse(responseText); } catch { data = {}; }

  if (!response.ok) {
    const errMsg = data.detail || data.message || data.error || responseText;
    const errStr = typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg);
    throw new Error(`AI transform HTTP ${response.status}: ${errStr.substring(0, 500)}`);
  }

  const imageUrl = data.images?.[0]?.url || data.image?.url || data.output?.[0]?.url || null;
  if (!imageUrl) throw new Error('AI transform: response içinde image URL yok');
  console.log(`[DEBUG-AI][${reqId}] fal returned imageUrl=${imageUrl}`);

  // Piksel-luminance tabanlı manuel alpha (applyFabricBlendEffect) sert/görünür kutu kenarı
  // bırakıyordu — gerçek segmentasyon modeli (BiRefNet) kullanıp doğru object/background
  // ayrımıyla şeffaf PNG alıyoruz. AI görseli zaten fal CDN'de barındığı için re-upload
  // gerekmiyor, aynı URL doğrudan removeBackground'a veriliyor.
  let finalUrl = imageUrl;
  if (useRealBgRemove) {
    try {
      const rmbg = await falProvider.removeBackground(imageUrl, workspaceId);
      finalUrl = rmbg.image_url;
      console.log(`[DEBUG-AI][${reqId}] BiRefNet BG-remove ✓ ${finalUrl}`);
    } catch (err) {
      console.warn(`[DEBUG-AI][${reqId}] BiRefNet BG-remove başarısız, opak AI görseliyle devam:`, err.message);
    }
  }

  const imgRes = await fetch(finalUrl);
  const outBuf = Buffer.from(await imgRes.arrayBuffer());
  const outHash = crypto.createHash('sha256').update(outBuf).digest('hex').slice(0, 12);
  console.log(`[DEBUG-AI][${reqId}] downloaded final output bytes=${outBuf.length} outHash=${outHash} hasRealAlpha=${finalUrl !== imageUrl}`);
  return outBuf;
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
 * @param {boolean}        [opts.useRealBgRemove=true] - AI stilizasyon sonrası BiRefNet ile gerçek segmentasyon/şeffaflık; false ise applyFabricBlendEffect/halftone (manuel piksel-alpha) kullanılır
 * @returns {Promise<{ buffer: Buffer, outputPath: string|null, width: number, height: number }>}
 */
async function generateFuryTourPoster({
  customerPhotoPath, petName, templateConfig = {}, outputPath = null,
  useAI = true, workspaceId = null,
  fabricBlend = true, fabricIntensity = 28,
  useRealBgRemove = true,
}) {
  if (!customerPhotoPath) throw new Error('customerPhotoPath required');

  const slot          = templateConfig.photoSlot || {};
  const tint          = templateConfig.tintColor || DEFAULT_TINT;
  const baseArtworkUrl = templateConfig.baseArtworkUrl || null;
  const isShellMode   = !!baseArtworkUrl;

  // petName yalnızca poster modda çizilir (shell modda başlık şablona gömülü)
  if (!isShellMode && !petName) throw new Error('petName required (poster mode)');

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
    const shellResized  = await sharp(shellPath).resize(containW, containH).toBuffer();
    const boxGrungeMatch = await buildBoxGrungeMatch(slotW, slotH);
    const canvasWithShell = await sharp({
      create: { width: OUTPUT_W, height: OUTPUT_H, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).composite([
      { input: shellResized, left: offsetX, top: offsetY },
      { input: boxGrungeMatch, left: slotX, top: slotY }, // kutunun flat rengini çevredeki grunge ile eşleştir — kedi üstüne binecek
    ]).png().toBuffer();
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

  // ── 1b: KATMAN 1 — AI stilizasyon (opsiyonel, başarısızsa Sharp-only fallback) ──
  let aiStylizedBuffer = null;
  let aiHasRealAlpha   = false; // BiRefNet gerçek segmentasyonla şeffaf arka plan verdiyse true
  if (useAI) {
    try {
      aiStylizedBuffer = await transformPhotoWithAI(cropSourceBuffer, workspaceId, useRealBgRemove);
      const aiMeta = await sharp(aiStylizedBuffer).metadata();
      aiHasRealAlpha = useRealBgRemove && !!aiMeta.hasAlpha;
      console.log(`[PhotoComposite] AI dönüşüm ✓ (fal-ai/gpt-image-2)${aiHasRealAlpha ? ' + BiRefNet gerçek alpha' : ''}`);
    } catch (err) {
      console.warn('[PhotoComposite] AI dönüşüm başarısız, Sharp-only fallback kullanılıyor:', err.message);
    }
  }
  const fitSourceBuffer = aiStylizedBuffer || cropSourceBuffer;

  // ── 2: KATMAN 2 — normalizasyon: AI çıktısı ne olursa olsun aynı kontrast
  // seviyesine zorlanır. AI kullanılmadıysa (fallback), kenar algılama eklenerek
  // düz bej bloklar yerine kontur hissi verilmeye çalışılır. fabricBlend orta
  // tonların gradyanına ihtiyaç duyar (alpha eğrisi onlar üzerinden çalışır) —
  // halftone'un sert kontrastı (1.8/-45) orta tonları siyah/beyaza yapıştırıp
  // eğriyi işlevsiz bırakırdı, o yüzden fabricBlend true iken daha yumuşak.
  const [contrastMul, contrastOffset] = fabricBlend ? [1.15, -10] : [1.8, -45];

  let fitPipeline = sharp(fitSourceBuffer)
    .resize(slotW, slotH, {
      fit:      slot.fit === 'contain' ? 'contain' : 'cover',
      position: slot.align ? mapAlign(slot.align) : 'centre',
    })
    .grayscale();

  if (!aiStylizedBuffer) {
    fitPipeline = fitPipeline.convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] });
  }

  const fitted = await fitPipeline
    .normalize()
    .linear(contrastMul, contrastOffset)
    .toColourspace('srgb')
    .toBuffer();

  // ── 2b/3: KATMAN 2 son adımı — aiHasRealAlpha ise BiRefNet zaten doğru
  // object/background ayrımını yapıp gerçek şeffaflık üretti, piksel-luminance
  // tabanlı manuel alpha hesaplaması (applyFabricBlendEffect) sert/görünür kutu
  // kenarı bırakıyordu, o yüzden bu durumda atlanır. Değilse fabricBlend true
  // ise "kumaşa gömülü" alpha efekti, değilse halftone + opak bej multiply blend ──
  let duotonePhoto;
  if (aiHasRealAlpha) {
    duotonePhoto = await applyRealAlphaDuotone(fitted, tint);
    if (process.env.DEBUG_CAT_ALONE) {
      try { fs.writeFileSync(process.env.DEBUG_CAT_ALONE, duotonePhoto); } catch (_) {}
    }
  } else if (fabricBlend) {
    duotonePhoto = await applyFabricBlendEffect(fitted, { intensity: fabricIntensity });
  } else {
    const stencil = await buildHalftoneDots(fitted, slotW, slotH, 9);

    const tintOverlay = await sharp({
      create: { width: slotW, height: slotH, channels: 3, background: hexToRgb(tint) },
    }).png().toBuffer();

    duotonePhoto = await sharp(stencil)
      .composite([{ input: tintOverlay, blend: 'multiply' }])
      .png()
      .toBuffer();
  }

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

  // ── 3c: sıkı clip — composite() left/top verilince input'u canvas'a göre
  // KIRPMAZ, kendi gerçek boyutuyla yapıştırır. fitted/duotonePhoto adımları
  // teorik olarak slotW×slotH çıkarır ama garanti değil (ör. fabricBlend'in raw
  // pipeline'ı veya ileride eklenecek bir adım boyutu kaydırabilir) — bu yüzden
  // composite'ten hemen önce gerçek boyutu ölçüp slotW×slotH'e sıkı kırpıyoruz.
  const duotoneMeta = await sharp(duotonePhoto).metadata();
  console.log(`[PhotoComposite] duotonePhoto boyutu: ${duotoneMeta.width}x${duotoneMeta.height} — beklenen slot: ${slotW}x${slotH}`);
  if (duotoneMeta.width !== slotW || duotoneMeta.height !== slotH) {
    console.warn('[PhotoComposite] Boyut uyuşmuyor — slot sınırlarına sıkı kırpılıyor.');
    duotonePhoto = await sharp(duotonePhoto)
      .extract({
        left: 0,
        top: 0,
        width: Math.min(slotW, duotoneMeta.width),
        height: Math.min(slotH, duotoneMeta.height),
      })
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

/**
 * 3 katmanlı akış için pozisyonel sarmalayıcı — AI stilizasyon + normalizasyon + kompozisyon.
 * @param {string|Buffer} customerPhotoPath
 * @param {object} [templateConfig]
 * @param {object} [options]
 * @param {string}  [options.petName]          - poster modda zorunlu, shell modda kullanılmaz
 * @param {string}  [options.outputPath]
 * @param {boolean} [options.useAI=true]       - false ise Sharp-only fallback
 * @param {string}  [options.workspaceId]      - workspace-scoped FAL key çözümü için
 * @param {boolean} [options.fabricBlend=true] - false ise halftone+opak bej blend
 * @param {number}  [options.fabricIntensity=28]
 * @param {boolean} [options.useRealBgRemove=true] - BiRefNet ile gerçek şeffaflık; false ise manuel alpha hesaplaması
 */
async function composePhoto(customerPhotoPath, templateConfig = {}, options = {}) {
  return generateFuryTourPoster({
    customerPhotoPath,
    petName:         options.petName || '',
    templateConfig,
    outputPath:      options.outputPath || null,
    useAI:           options.useAI !== false,
    workspaceId:     options.workspaceId || null,
    fabricBlend:     options.fabricBlend !== false,
    fabricIntensity: options.fabricIntensity,
    useRealBgRemove: options.useRealBgRemove !== false,
  });
}

module.exports = {
  OUTPUT_W,
  OUTPUT_H,
  DEFAULT_TINT,
  DEFAULT_TOUR_CITIES,
  generateFuryTourPoster,
  composePhoto,
  applyFabricBlendEffect,
  transformPhotoWithAI,
};
