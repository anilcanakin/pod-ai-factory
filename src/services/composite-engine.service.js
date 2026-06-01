'use strict';

const sharp  = require('sharp');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

const ASSETS_ROOT = path.join(__dirname, '../../assets');
const REPO_ROOT   = path.join(__dirname, '../../');

// Lazy requires — only resolved at call time so tests don't fail at module load
// when DB/Redis isn't available. outputDir tests bypass both entirely.
let _uploadToStorage = null;
let _renderMockup    = null;
function getUploadToStorage() {
  if (!_uploadToStorage) _uploadToStorage = require('./storage.service').uploadToStorage;
  return _uploadToStorage;
}
function getRenderMockup() {
  if (!_renderMockup) _renderMockup = require('./mockup-render.service').renderMockup;
  return _renderMockup;
}

// ─── Font Registry ────────────────────────────────────────────────────────────
const FONT_REGISTRY = {
  'Montserrat-Bold':    path.join(ASSETS_ROOT, 'fonts/Montserrat-Bold.ttf'),
  'Montserrat-Regular': path.join(ASSETS_ROOT, 'fonts/Montserrat-Regular.ttf'),
};

// Module-level font cache (path → base64 string)
const _fontCache = new Map();

function loadFontB64(fontPath) {
  if (_fontCache.has(fontPath)) return _fontCache.get(fontPath);
  const b64 = fs.readFileSync(fontPath).toString('base64');
  _fontCache.set(fontPath, b64);
  return b64;
}

// ─── Validation ───────────────────────────────────────────────────────────────
function validateTemplateConfig(template) {
  const layers = Array.isArray(template.textLayers) ? template.textLayers : [];
  for (const layer of layers) {
    if (!FONT_REGISTRY[layer.font]) {
      throw new Error(
        `Unknown font: "${layer.font}". Add it to FONT_REGISTRY in composite-engine.service.js`
      );
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Rough heuristic: 0.55 × fontSize per character (safe for Latin sans-serif).
function estimateTextWidth(text, fontSize) {
  return text.length * fontSize * 0.55;
}

function buildCircleMaskSvg(slotW, slotH, radius) {
  const cx = slotW / 2, cy = slotH / 2;
  return `<svg width="${slotW}" height="${slotH}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${slotW}" height="${slotH}" fill="black"/>
  <circle cx="${cx}" cy="${cy}" r="${radius}" fill="white"/>
</svg>`;
}

function buildTextSvg({ canvasW, canvasH, layer, text, fontB64 }) {
  const anchor = layer.align === 'center' ? 'middle'
               : layer.align === 'right'  ? 'end' : 'start';

  const naturalWidth  = estimateTextWidth(text, layer.size);
  const useTextLength = layer.maxWidth && naturalWidth > layer.maxWidth;
  const textLengthAttr = useTextLength
    ? `textLength="${layer.maxWidth}" lengthAdjust="spacingAndGlyphs"`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">
  <defs>
    <style>
      @font-face {
        font-family: '${layer.font}';
        src: url('data:font/truetype;base64,${fontB64}');
      }
    </style>
  </defs>
  <text
    x="${layer.x}"
    y="${layer.y}"
    font-family="'${layer.font}'"
    font-size="${layer.size}"
    fill="${layer.color}"
    text-anchor="${anchor}"
    ${textLengthAttr}
  >${escapeXml(text)}</text>
</svg>`;
}

function mapAlign(align) {
  const map = { center: 'centre', top: 'top', bottom: 'bottom', left: 'left', right: 'right' };
  return map[align] || 'centre';
}

// ─── Main Engine ──────────────────────────────────────────────────────────────

/**
 * @param {object}          opts
 * @param {string}          opts.orderId
 * @param {object}          opts.template        - Full PhotoTemplate row
 * @param {object|null}     opts.mockupTemplate  - MockupTemplate row or null
 * @param {Buffer|string}   opts.customerPhoto   - Buffer, absolute path, or relative assets/ path
 * @param {object}          opts.variables       - { name?, year?, customText? }
 * @param {string}          opts.workspaceId
 * @param {string}          [opts.outputDir]     - Override output dir (tests only)
 * @returns {Promise<{ printFileUrl: string, mockupUrl: string|null, warnings: string[] }>}
 */
async function compositePhoto({ orderId, template, mockupTemplate, customerPhoto, variables, workspaceId, outputDir }) {
  const warnings = [];
  const slot = template.photoSlot;

  // ── Step 1: Resolve customer photo to Buffer ──────────────────────────────
  let rawBuffer;
  if (Buffer.isBuffer(customerPhoto)) {
    rawBuffer = customerPhoto;
  } else {
    const src = String(customerPhoto);
    const absPath = src.startsWith('http')
      ? await _downloadToTemp(src)
      : (path.isAbsolute(src) ? src : path.join(REPO_ROOT, src));
    rawBuffer = fs.readFileSync(absPath);
  }

  // ── Step 2: EXIF auto-orient + strip ─────────────────────────────────────
  const orientedBuffer = await sharp(rawBuffer).rotate().toBuffer();

  // ── Step 3: Resolution check — slot-relative ──────────────────────────────
  const meta = await sharp(orientedBuffer).metadata();
  if (meta.width < slot.width || meta.height < slot.height) {
    warnings.push('low_resolution');
  }

  // ── Step 4: Fit into photo slot ───────────────────────────────────────────
  let fittedBuffer = await sharp(orientedBuffer)
    .resize(slot.width, slot.height, {
      fit:      slot.fit === 'contain' ? 'contain' : 'cover',
      position: mapAlign(slot.align),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  // ── Step 5: Apply borderRadius clip ──────────────────────────────────────
  if (slot.borderRadius > 0) {
    const maskSvg = buildCircleMaskSvg(slot.width, slot.height, slot.borderRadius);
    fittedBuffer = await sharp(fittedBuffer)
      .composite([{ input: Buffer.from(maskSvg), blend: 'dest-in' }])
      .png()
      .toBuffer();
  }

  // ── Step 6: Load base artwork ─────────────────────────────────────────────
  const baseUrl = template.baseArtworkUrl;
  const basePath = baseUrl.startsWith('http')
    ? await _downloadToTemp(baseUrl)
    : (path.isAbsolute(baseUrl) ? baseUrl : path.join(REPO_ROOT, baseUrl));

  // ── Step 7: Composite photo onto base ────────────────────────────────────
  let compositeChain = sharp(basePath).composite([
    { input: fittedBuffer, left: Math.round(slot.x), top: Math.round(slot.y) }
  ]);

  // ── Step 8: Render text layers ────────────────────────────────────────────
  const layers = Array.isArray(template.textLayers) ? template.textLayers : [];
  for (const layer of layers) {
    const rawValue = variables[layer.key];
    if (rawValue === undefined || rawValue === null) continue;

    let text = String(rawValue);
    if (layer.transform === 'uppercase') text = text.toUpperCase();
    if (layer.transform === 'lowercase') text = text.toLowerCase();

    const fontPath = FONT_REGISTRY[layer.font];
    const fontB64  = loadFontB64(fontPath);
    const svg      = buildTextSvg({
      canvasW: template.printWidthPx,
      canvasH: template.printHeightPx,
      layer, text, fontB64,
    });

    const currentBuf = await compositeChain.toBuffer();
    compositeChain = sharp(currentBuf).composite([
      { input: Buffer.from(svg), blend: 'over' }
    ]);
  }

  const printBuffer = await compositeChain.png().toBuffer();

  // ── Step 9: Write print file ──────────────────────────────────────────────
  let printFileUrl;
  if (outputDir) {
    // Test mode — write directly to outputDir, return absolute path
    const outPath = path.join(outputDir, `${orderId}_print.png`);
    fs.writeFileSync(outPath, printBuffer);
    printFileUrl = outPath;
  } else {
    // Production mode — use uploadToStorage
    const tmpPrint = path.join(os.tmpdir(), `${orderId}_print.png`);
    fs.writeFileSync(tmpPrint, printBuffer);
    try {
      printFileUrl = await getUploadToStorage()(tmpPrint, `personalization/print-files/${orderId}_print.png`);
    } finally {
      if (fs.existsSync(tmpPrint)) fs.unlinkSync(tmpPrint);
    }
  }

  // ── Step 10: Generate garment mockup ─────────────────────────────────────
  let mockupUrl = null;
  if (mockupTemplate && !outputDir) {
    const tmpDesign = path.join(os.tmpdir(), `${orderId}_design.png`);
    fs.writeFileSync(tmpDesign, printBuffer);
    try {
      mockupUrl = await getRenderMockup()({
        designPath:  tmpDesign,
        template:    mockupTemplate,
        imageId:     orderId,
        workspaceId,
        placement:   template.mockupConfig?.placement ?? {},
      });
    } finally {
      if (fs.existsSync(tmpDesign)) fs.unlinkSync(tmpDesign);
    }
  }

  return { printFileUrl, mockupUrl, warnings };
}

async function _downloadToTemp(url) {
  const fetch = require('node-fetch');
  const res   = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch: ${url} (${res.status})`);
  const buf  = await res.buffer();
  const tmp  = path.join(os.tmpdir(), `dl-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(tmp, buf);
  return tmp;
}

module.exports = {
  FONT_REGISTRY,
  validateTemplateConfig,
  escapeXml,
  estimateTextWidth,
  buildCircleMaskSvg,
  buildTextSvg,
  mapAlign,
  loadFontB64,
  compositePhoto,
};
