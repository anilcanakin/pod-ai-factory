'use strict';

const sharp  = require('sharp');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

const ASSETS_ROOT = path.join(__dirname, '../../assets');
const REPO_ROOT   = path.join(__dirname, '../../');

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

module.exports = {
  FONT_REGISTRY,
  validateTemplateConfig,
  escapeXml,
  estimateTextWidth,
  buildCircleMaskSvg,
  buildTextSvg,
  mapAlign,
  loadFontB64,
};
