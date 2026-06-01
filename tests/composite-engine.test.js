'use strict';
const { test, describe } = require('node:test');
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
