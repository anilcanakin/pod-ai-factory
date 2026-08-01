'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const sharp  = require('sharp');
const os     = require('os');
const fs     = require('fs');

// Helpers under test — imported after engine is created
let engine;
try { engine = require('../src/services/composite-engine.service'); } catch (_) {}

// ── 1. estimateTextWidth ──────────────────────────────────────────────────────
describe('estimateTextWidth', () => {
  test('short name stays well under maxWidth', () => {
    const w = engine.estimateTextWidth('Emma', 64);
    assert.ok(w < 700, `expected < 700, got ${w}`);
    assert.ok(w > 0);
  });
  test('long name exceeds maxWidth', () => {
    const w = engine.estimateTextWidth('Bartholomew Christopher', 64);
    assert.ok(w > 700, `expected > 700, got ${w}`);
  });
  test('two-char name produces small width', () => {
    const w = engine.estimateTextWidth('Jo', 64);
    assert.ok(w < 200, `expected < 200, got ${w}`);
  });
});

// ── 2. buildTextSvg — textLength conditional ─────────────────────────────────
describe('buildTextSvg', () => {
  const layer = {
    x: 600, y: 880, font: 'Montserrat-Bold', size: 64,
    color: '#FFFFFF', align: 'center', maxWidth: 700
  };
  const fontB64 = 'AAAA'; // dummy — SVG structure test only

  test('short text: NO textLength attribute emitted', () => {
    const svg = engine.buildTextSvg({ canvasW: 1200, canvasH: 1440, layer, text: 'Emma', fontB64 });
    assert.ok(!svg.includes('textLength'), 'textLength should not appear for short text');
    assert.ok(svg.includes('>Emma<') || svg.includes('>EMMA<'), 'text content present');
  });

  test('long text: textLength IS emitted', () => {
    const svg = engine.buildTextSvg({
      canvasW: 1200, canvasH: 1440, layer,
      text: 'Bartholomew Christopher', fontB64
    });
    assert.ok(svg.includes('textLength="700"'), 'textLength should appear for overflowing text');
    assert.ok(svg.includes('spacingAndGlyphs'));
  });

  test('SVG contains @font-face with base64 data', () => {
    const svg = engine.buildTextSvg({ canvasW: 1200, canvasH: 1440, layer, text: 'Hi', fontB64: 'BASE64DATA' });
    assert.ok(svg.includes('BASE64DATA'), '@font-face embed present');
    assert.ok(svg.includes("font-family: 'Montserrat-Bold'") || svg.includes('font-family:'), 'font-family declared');
  });
});

// ── 3. buildCircleMaskSvg ─────────────────────────────────────────────────────
describe('buildCircleMaskSvg', () => {
  test('returns valid SVG containing a circle', () => {
    const svg = engine.buildCircleMaskSvg(600, 600, 300);
    assert.ok(svg.includes('<circle'), 'circle element present');
    assert.ok(svg.includes('r="300"'), 'correct radius');
    assert.ok(svg.includes('width="600"'));
  });
});

// ── 4. escapeXml ─────────────────────────────────────────────────────────────
describe('escapeXml', () => {
  test('escapes & < > " \'', () => {
    const result = engine.escapeXml(`<b>O'Reilly & "Co"`);
    assert.equal(result, '&lt;b&gt;O&apos;Reilly &amp; &quot;Co&quot;');
  });
});

// ── 5. EXIF orient ───────────────────────────────────────────────────────────
describe('EXIF orient', () => {
  test('output buffer after sharp rotate has no problematic orientation', async () => {
    const input = await sharp({
      create: { width: 100, height: 60, channels: 3, background: { r: 255, g: 0, b: 0 } }
    }).jpeg().toBuffer();
    const result = await sharp(input).rotate().toBuffer();
    const meta = await sharp(result).metadata();
    assert.ok(!meta.orientation || meta.orientation === 1,
      `orientation should be absent or 1, got ${meta.orientation}`);
  });
});

// ── 6. Full compositePhoto integration ───────────────────────────────────────
describe('compositePhoto', () => {
  test('produces PNG at correct dimensions with text layers', async () => {
    if (!engine || !engine.compositePhoto) {
      assert.fail('compositePhoto not yet implemented');
    }

    const printW = 400, printH = 480;
    const slotW  = 200, slotH = 200;

    // Base artwork: golden background
    const baseBuffer = await sharp({
      create: { width: printW, height: printH, channels: 3, background: { r: 212, g: 175, b: 55 } }
    }).png().toBuffer();
    const baseTmpPath = path.join(os.tmpdir(), `test-base-${Date.now()}.png`);
    fs.writeFileSync(baseTmpPath, baseBuffer);

    // Customer photo: 250×250 red square (above 200px slot threshold)
    const customerBuffer = await sharp({
      create: { width: 250, height: 250, channels: 3, background: { r: 255, g: 0, b: 0 } }
    }).jpeg().toBuffer();
    const customerTmpPath = path.join(os.tmpdir(), `test-customer-${Date.now()}.jpg`);
    fs.writeFileSync(customerTmpPath, customerBuffer);

    const template = {
      id: 'test-tmpl',
      baseArtworkUrl: baseTmpPath,
      printWidthPx: printW,
      printHeightPx: printH,
      photoSlot: { x: 100, y: 50, width: slotW, height: slotH, fit: 'cover', align: 'center', borderRadius: 0, rotation: 0 },
      textLayers: [
        { key: 'name', x: 200, y: 320, font: 'Montserrat-Bold', size: 32, color: '#FFFFFF', align: 'center', maxWidth: 350, transform: 'uppercase' },
        { key: 'year', x: 200, y: 360, font: 'Montserrat-Regular', size: 24, color: '#FFD700', align: 'center', maxWidth: 300, transform: null },
      ],
      mockupConfig: { mockupTemplateId: null },
    };

    const result = await engine.compositePhoto({
      orderId:        'test-order-123',
      template,
      mockupTemplate: null,
      customerPhoto:  customerTmpPath,
      variables:      { name: 'Emma', year: '1996' },
      workspaceId:    'test-workspace',
      outputDir:      os.tmpdir(),
    });

    assert.ok(result.printFileUrl, 'printFileUrl populated');
    assert.equal(result.mockupUrl, null, 'mockupUrl null when mockupTemplate is null');

    const outMeta = await sharp(result.printFileUrl).metadata();
    assert.equal(outMeta.width,  printW, `width should be ${printW}`);
    assert.equal(outMeta.height, printH, `height should be ${printH}`);

    // Cleanup
    fs.unlinkSync(baseTmpPath);
    fs.unlinkSync(customerTmpPath);
    if (fs.existsSync(result.printFileUrl)) fs.unlinkSync(result.printFileUrl);
  });

  test('emits low_resolution warning when photo smaller than slot', async () => {
    if (!engine || !engine.compositePhoto) assert.fail('compositePhoto not yet implemented');

    const printW = 400, printH = 480;
    const baseBuffer = await sharp({
      create: { width: printW, height: printH, channels: 3, background: { r: 212, g: 175, b: 55 } }
    }).png().toBuffer();
    const baseTmpPath = path.join(os.tmpdir(), `test-base2-${Date.now()}.png`);
    fs.writeFileSync(baseTmpPath, baseBuffer);

    // 50×50 photo — smaller than 200×200 slot → must warn
    const tinyBuffer = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 0, b: 255 } }
    }).jpeg().toBuffer();
    const tinyPath = path.join(os.tmpdir(), `test-tiny-${Date.now()}.jpg`);
    fs.writeFileSync(tinyPath, tinyBuffer);

    const template = {
      id: 'test-tmpl-2',
      baseArtworkUrl: baseTmpPath,
      printWidthPx: printW, printHeightPx: printH,
      photoSlot: { x: 100, y: 50, width: 200, height: 200, fit: 'cover', align: 'center', borderRadius: 0, rotation: 0 },
      textLayers: [],
      mockupConfig: { mockupTemplateId: null },
    };

    const result = await engine.compositePhoto({
      orderId: 'test-order-lowres', template, mockupTemplate: null,
      customerPhoto: tinyPath, variables: {}, workspaceId: 'test-ws',
      outputDir: os.tmpdir(),
    });

    assert.ok(result.warnings.includes('low_resolution'), 'low_resolution warning emitted');

    fs.unlinkSync(baseTmpPath);
    fs.unlinkSync(tinyPath);
    if (result.printFileUrl && fs.existsSync(result.printFileUrl)) fs.unlinkSync(result.printFileUrl);
  });
});

// ── Helpers for glyph-path assertions ──────────────────────────────────────────

// Extracts the numeric d="..." attribute of the (single, top-level) <path> emitted
// by buildTextPathSvg and returns its unscaled bounding-box width. Coordinates in
// the d string always alternate x,y per command point (M/L/Q/C — see
// pathCommandsToD in composite-engine.service.js), so even indices are all x's.
function pathWidth(svg) {
  const d = svg.match(/<path d="([^"]*)"/)[1];
  const nums = d.match(/-?\d+\.\d+|-?\d+/g).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  return Math.max(...xs) - Math.min(...xs);
}

// Scans a PNG buffer for the first fully-opaque pixel (alpha === 255) and returns
// its RGB. Solid single-color glyph fills produce fully-opaque interior pixels, so
// this reliably samples the actual ink color without needing exact coordinates.
async function firstOpaquePixel(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] === 255) return { r: data[i], g: data[i + 1], b: data[i + 2] };
  }
  return null;
}

// ── 7. buildTextPathSvg — glyph path integrity (opentype.js NaN bug regression) ─
describe('buildTextPathSvg', () => {
  const canvasW = 1200, canvasH = 1440;
  const fontPath = engine.FONT_REGISTRY['Montserrat-Bold'];
  const baseLayer = { x: 100, y: 300, size: 60, color: '#000000', align: 'left', font: 'Montserrat-Bold' };

  const samples = [
    ['short text', 'Jo'],
    ['long text', 'Congratulations Class of 2026 Graduate'],
    ['accented text', 'José García Muñoz'],
    ["apostrophe + hyphen (real order name)", "Mrs. O'Brien-Rodriguez"],
  ];

  for (const [label, text] of samples) {
    test(`${label}: glyph path contains no NaN`, () => {
      const svg = engine.buildTextPathSvg({ canvasW, canvasH, layer: baseLayer, text, fontPath });
      const d = svg.match(/<path d="([^"]*)"/)[1];
      assert.ok(d.length > 0, 'path d should not be empty');
      assert.ok(!/NaN/.test(d), `path data contains NaN for "${text}": ${d.slice(0, 200)}`);
    });
  }

  test('scaleX default (1): no scale wrapper, rendered width respects maxWidth', () => {
    const layer = { ...baseLayer, maxWidth: 300 };
    const svg = engine.buildTextPathSvg({
      canvasW, canvasH, layer, text: 'A Wonderfully Long Example Sample Name', fontPath,
    });
    assert.ok(!svg.includes('<g transform'), 'no scale wrapper when scaleX is default (1)');
    const width = pathWidth(svg);
    assert.ok(width <= 301, `expected rendered width <= 301, got ${width}`);
  });

  test('scaleX 0.5: width computation accounts for scaleX under maxWidth', () => {
    const text = 'A Wonderfully Long Example Sample Name';
    const layerNoScale   = { ...baseLayer, maxWidth: 300 };
    const layerHalfScale = { ...baseLayer, maxWidth: 300, scaleX: 0.5 };

    const svgNoScale   = engine.buildTextPathSvg({ canvasW, canvasH, layer: layerNoScale,   text, fontPath });
    const svgHalfScale = engine.buildTextPathSvg({ canvasW, canvasH, layer: layerHalfScale, text, fontPath });

    assert.ok(svgHalfScale.includes('<g transform="scale(0.5 1)">'), 'scale wrapper present when scaleX != 1');

    const unscaledWidthNoScale   = pathWidth(svgNoScale);
    const unscaledWidthHalfScale = pathWidth(svgHalfScale);
    const renderedWidthHalfScale = unscaledWidthHalfScale * 0.5;

    // Screen-space width (post-scale) must still respect maxWidth in both cases —
    // this is the regression the scaleX*width comparison in buildTextPathSvg protects.
    assert.ok(renderedWidthHalfScale <= 301, `expected rendered width <= 301, got ${renderedWidthHalfScale}`);

    // scaleX=0.5 needs LESS font-size shrinking to fit the same maxWidth (its on-screen
    // width is already halved), so its unscaled glyph path should stay wider than the
    // scaleX=1 case. If a future change dropped scaleX from the maxWidth comparison,
    // both would shrink identically and this assertion would fail.
    assert.ok(unscaledWidthHalfScale > unscaledWidthNoScale,
      `expected scaleX=0.5 unscaled width (${unscaledWidthHalfScale}) > scaleX=1 unscaled width (${unscaledWidthNoScale})`);
  });
});

// ── 8. composeTextOnlyDesign — garmentColor / inkTintable ──────────────────────
describe('composeTextOnlyDesign', () => {
  const printW = 600, printH = 400;
  let baseArtworkPath;

  before(async () => {
    const buf = await sharp({
      create: { width: printW, height: printH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png().toBuffer();
    baseArtworkPath = path.join(os.tmpdir(), `test-text-only-base-${Date.now()}.png`);
    fs.writeFileSync(baseArtworkPath, buf);
  });

  after(() => {
    if (baseArtworkPath && fs.existsSync(baseArtworkPath)) fs.unlinkSync(baseArtworkPath);
  });

  function baseTemplate(inkTintable) {
    return {
      printWidthPx:  printW,
      printHeightPx: printH,
      mockupConfig:  { inkTintable },
      textLayers: [
        { key: 'name', font: 'Montserrat-Bold', size: 80, x: 300, y: 220, color: '#1d1d1b', align: 'center' },
      ],
    };
  }

  test('inkTintable:false — garmentColor is ignored, output byte-identical (regression: other templates unaffected)', async () => {
    const template = baseTemplate(false);
    const withoutColor = await engine.composeTextOnlyDesign(baseArtworkPath, template, { name: 'Emma' }, {});
    const withColor    = await engine.composeTextOnlyDesign(baseArtworkPath, template, { name: 'Emma' }, { garmentColor: '#000000' });
    assert.ok(withoutColor.equals(withColor), 'output must be byte-identical when inkTintable is false, regardless of garmentColor');
  });

  test('inkTintable:true — light garmentColor uses dark ink, dark garmentColor uses light ink', async () => {
    const template = baseTemplate(true);

    const lightBg = await engine.composeTextOnlyDesign(baseArtworkPath, template, { name: 'Emma' }, { garmentColor: '#FFFFFF' });
    const darkBg  = await engine.composeTextOnlyDesign(baseArtworkPath, template, { name: 'Emma' }, { garmentColor: '#000000' });

    assert.ok(!lightBg.equals(darkBg), 'output must differ between light and dark garmentColor');

    const lightInk = await firstOpaquePixel(lightBg);
    const darkInk  = await firstOpaquePixel(darkBg);

    assert.deepEqual(lightInk, { r: 0x1d, g: 0x1d, b: 0x1b }, 'light garment background should use DEFAULT_INK (#1d1d1b)');
    assert.deepEqual(darkInk,  { r: 0xff, g: 0xff, b: 0xff }, 'dark garment background should use CONTRAST_INK (#FFFFFF)');
  });
});
