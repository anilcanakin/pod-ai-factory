# Photo Personalization Composite Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an occasion-agnostic photo-personalization composite engine that takes a customer photo + a template + variables and produces a print-ready PNG and a garment mockup, with a BullMQ-backed approval queue API.

**Architecture:** Sharp + SVG @font-face overlays handle all image compositing (no new raster libs). The engine (`composite-engine.service.js`) is pure — it receives a template object and returns URLs; all DB state transitions live in the BullMQ worker. Two new Prisma models (`PhotoTemplate`, `PersonalizationOrder`) with a BullMQ-only retry strategy (no dual-mechanism).

**Tech Stack:** Node.js/Express 5, Sharp, BullMQ + Redis, Prisma 5/PostgreSQL, `node:test` for unit tests, curl for acceptance test.

**Spec:** `docs/superpowers/specs/2026-06-01-photo-personalization-design.md`

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/services/composite-engine.service.js` | `compositePhoto()`, font registry, SVG builders, resolution check |
| Create | `src/queues/personalization.worker.js` | BullMQ worker — DB state transitions + engine call |
| Create | `src/routes/personalization.routes.js` | Order CRUD + approve/reject |
| Create | `src/routes/photo-template.routes.js` | PhotoTemplate CRUD |
| Create | `scripts/seed-birthday-template.js` | Seeds birthday template with Sharp-generated base artwork |
| Create | `tests/composite-engine.test.js` | Unit tests for engine helpers (`node:test`) |
| Modify | `prisma/schema.prisma` | Add PhotoTemplate + PersonalizationOrder models + Workspace relations |
| Modify | `src/queues/index.js` | Add `personalizationQueue` |
| Modify | `src/index.js` | Mount two new routes + register personalization worker |
| Download | `assets/fonts/Montserrat-Bold.ttf` | Bundled font for SVG rendering |
| Download | `assets/fonts/Montserrat-Regular.ttf` | Bundled font for SVG rendering |

---

## Task 1: Prisma Schema + Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Run: `npx prisma migrate dev`

- [ ] **Step 1.1 — Add models to `prisma/schema.prisma`**

Open `prisma/schema.prisma`. After the `FinancialTransaction` model at the end of the file, append:

```prisma
// ─── Photo Personalization ────────────────────────────────────────────────────

enum PersonalizationStatus {
  PENDING
  COMPOSITING
  COMPOSITED
  APPROVED
  REJECTED
  SENT
  FAILED
}

model PhotoTemplate {
  id             String   @id @default(uuid())
  workspaceId    String
  workspace      Workspace @relation(fields: [workspaceId], references: [id])
  name           String
  occasion       String
  baseArtworkUrl String
  photoSlot      Json
  textLayers     Json
  printWidthPx   Int
  printHeightPx  Int
  mockupConfig   Json
  active         Boolean  @default(true)
  createdAt      DateTime @default(now())

  orders         PersonalizationOrder[]

  @@index([workspaceId, occasion])
}

model PersonalizationOrder {
  id               String                @id @default(uuid())
  workspaceId      String
  workspace        Workspace             @relation(fields: [workspaceId], references: [id])
  etsyOrderRef     String?
  templateId       String
  template         PhotoTemplate         @relation(fields: [templateId], references: [id])
  customerPhotoUrl String
  variables        Json
  status           PersonalizationStatus @default(PENDING)
  printFileUrl     String?
  mockupUrl        String?
  warnings         Json?
  rejectionReason  String?
  createdAt        DateTime             @default(now())
  updatedAt        DateTime             @updatedAt

  @@index([workspaceId, status])
}
```

- [ ] **Step 1.2 — Add relations to `Workspace` model**

Inside the `Workspace` model in `prisma/schema.prisma`, add these two lines after `styleProfiles StyleProfile[]`:

```prisma
  photoTemplates        PhotoTemplate[]
  personalizationOrders PersonalizationOrder[]
```

- [ ] **Step 1.3 — Run migration**

```bash
cd C:\Users\Anılcan\Desktop\pod-ai-factory
npx prisma migrate dev --name add_personalization
```

Expected output ends with:
```
Your database is now in sync with your schema.
✔ Generated Prisma Client
```

- [ ] **Step 1.4 — Verify Prisma client regenerated**

```bash
node -e "const p = require('./src/lib/prisma'); console.log(typeof p.photoTemplate, typeof p.personalizationOrder)"
```

Expected: `object object`

- [ ] **Step 1.5 — Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add PhotoTemplate and PersonalizationOrder Prisma models"
```

---

## Task 2: Font Assets

**Files:**
- Create: `assets/fonts/Montserrat-Bold.ttf`
- Create: `assets/fonts/Montserrat-Regular.ttf`

- [ ] **Step 2.1 — Create fonts directory and download**

```bash
mkdir -p assets/fonts
curl -L "https://github.com/google/fonts/raw/main/ofl/montserrat/static/Montserrat-Regular.ttf" -o assets/fonts/Montserrat-Regular.ttf
curl -L "https://github.com/google/fonts/raw/main/ofl/montserrat/static/Montserrat-Bold.ttf" -o assets/fonts/Montserrat-Bold.ttf
```

- [ ] **Step 2.2 — Verify both files exist and are non-zero**

```bash
ls -lh assets/fonts/
```

Expected: both `.ttf` files present, each ~200-500 KB.

- [ ] **Step 2.3 — Add fonts directory to git (binary files)**

```bash
git add assets/fonts/
git commit -m "chore: bundle Montserrat fonts for SVG text rendering"
```

---

## Task 3: Composite Engine — Core Helpers + Unit Test Setup

**Files:**
- Create: `src/services/composite-engine.service.js` (stubs + helpers)
- Create: `tests/composite-engine.test.js`

- [ ] **Step 3.1 — Add test script to `package.json`**

In `package.json`, find the `"scripts"` block and add:

```json
"test:composite": "node --test tests/composite-engine.test.js"
```

- [ ] **Step 3.2 — Create `tests/` directory and write failing tests for helpers**

Create `tests/composite-engine.test.js`:

```js
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
    assert.ok(svg.includes('>EMMA<') || svg.includes('>Emma<'), 'text content present');
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
    assert.ok(svg.includes("font-family: 'Montserrat-Bold'"), 'font-family declared');
  });

  test('uppercase transform applied before render', () => {
    const layerUpper = { ...layer, transform: 'uppercase' };
    // transform is applied by the caller (worker/test), not inside buildTextSvg
    const text = 'emma';
    const transformed = layerUpper.transform === 'uppercase' ? text.toUpperCase() : text;
    assert.equal(transformed, 'EMMA');
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

// ── 5. EXIF orient + metadata strip ──────────────────────────────────────────
describe('EXIF orient', () => {
  test('output buffer has no EXIF orientation tag', async () => {
    // Create a 100×60 test image (no EXIF)
    const input = await sharp({ create: { width: 100, height: 60, channels: 3, background: { r: 255, g: 0, b: 0 } } })
      .jpeg().toBuffer();
    const result = await sharp(input).rotate().toBuffer();
    const meta = await sharp(result).metadata();
    // After .rotate(), orientation field should be absent or 1
    assert.ok(!meta.orientation || meta.orientation === 1, `orientation should be absent, got ${meta.orientation}`);
  });
});
```

- [ ] **Step 3.3 — Run tests to confirm they all fail (engine not yet created)**

```bash
cd C:\Users\Anılcan\Desktop\pod-ai-factory
npm run test:composite 2>&1 | head -30
```

Expected: errors like `Cannot find module` or multiple test failures.

- [ ] **Step 3.4 — Create `src/services/composite-engine.service.js` with helpers only**

```js
'use strict';

const sharp  = require('sharp');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

const ASSETS_ROOT = path.join(__dirname, '../../assets');
const REPO_ROOT   = path.join(__dirname, '../../');

// ─── Font Registry ────────────────────────────────────────────────────────────
// Keys must match textLayers[].font values in PhotoTemplate records.
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
      throw new Error(`Unknown font: "${layer.font}". Add it to FONT_REGISTRY in composite-engine.service.js`);
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
// Conservative on purpose — occasional false-positive (mild compress) is fine;
// false-negative (short text never stretched).
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
```

- [ ] **Step 3.5 — Run tests again — all helpers should pass now**

```bash
npm run test:composite 2>&1
```

Expected: all tests pass (`▶ estimateTextWidth`, `▶ buildTextSvg`, `▶ buildCircleMaskSvg`, `▶ escapeXml`, `▶ EXIF orient`).

- [ ] **Step 3.6 — Commit**

```bash
git add src/services/composite-engine.service.js tests/composite-engine.test.js package.json
git commit -m "feat: composite engine helpers + unit tests (font registry, SVG builders, EXIF)"
```

---

## Task 4: Composite Engine — `compositePhoto()` Full Pipeline

**Files:**
- Modify: `src/services/composite-engine.service.js` (add compositePhoto + integration test)
- Modify: `tests/composite-engine.test.js` (add full composite test)

- [ ] **Step 4.1 — Write failing integration test**

Append to `tests/composite-engine.test.js`:

```js
// ── 6. Full compositePhoto integration ───────────────────────────────────────
describe('compositePhoto', () => {
  test('produces PNG at correct dimensions with text layers', async () => {
    if (!engine || !engine.compositePhoto) {
      assert.fail('compositePhoto not yet implemented');
    }

    // Build a minimal in-memory template (no DB needed)
    const printW = 400, printH = 480;
    const slotW  = 200, slotH = 200;

    // Generate base artwork in memory (golden background)
    const baseBuffer = await sharp({
      create: { width: printW, height: printH, channels: 3, background: { r: 212, g: 175, b: 55 } }
    }).png().toBuffer();

    // Write base to temp file (engine accepts paths)
    const baseTmpPath = path.join(os.tmpdir(), `test-base-${Date.now()}.png`);
    fs.writeFileSync(baseTmpPath, baseBuffer);

    // Generate a customer photo (200×200 red square — above slot threshold)
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
      orderId:       'test-order-123',
      template,
      mockupTemplate: null,
      customerPhoto:  customerTmpPath,
      variables:      { name: 'Emma', year: '1996' },
      workspaceId:    'test-workspace',
      outputDir:      os.tmpdir(),   // override output dir for tests
    });

    // Verify output PNG dimensions
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

    // 50×50 photo — smaller than 200×200 slot → should warn
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
```

- [ ] **Step 4.2 — Run tests to confirm new tests fail**

```bash
npm run test:composite 2>&1 | grep -E "FAIL|fail|not yet implemented|error" | head -10
```

Expected: `compositePhoto not yet implemented` failures.

- [ ] **Step 4.3 — Implement `compositePhoto()` — add to `composite-engine.service.js`**

Add these requires at the top of the file (after existing requires):

```js
const { uploadToStorage } = require('./storage.service');
const { renderMockup }    = require('./mockup-render.service');
const prisma              = require('../lib/prisma');
```

Then append `compositePhoto` and its helpers at the bottom, before `module.exports`:

```js
// ─── Main Engine ──────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string}          opts.orderId
 * @param {object}          opts.template        - Full PhotoTemplate row (parsed JSON fields)
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
    // Absolute path, relative path, or HTTP URL
    const absPath = String(customerPhoto).startsWith('http')
      ? await _downloadToTemp(customerPhoto)
      : (path.isAbsolute(customerPhoto) ? customerPhoto : path.join(REPO_ROOT, customerPhoto));
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
    if (rawValue === undefined || rawValue === null) continue;  // optional — skip silently

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

    // Re-chain: read current buffer, composite text, continue
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
    const storagePath = `personalization/print-files/${orderId}_print.png`;
    printFileUrl = await uploadToStorage(tmpPrint, storagePath);
    fs.unlinkSync(tmpPrint);
  }

  // ── Step 10: Generate garment mockup ─────────────────────────────────────
  let mockupUrl = null;
  if (mockupTemplate && !outputDir) {
    const tmpDesign = path.join(os.tmpdir(), `${orderId}_design.png`);
    fs.writeFileSync(tmpDesign, printBuffer);
    try {
      mockupUrl = await renderMockup({
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

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function _downloadToTemp(url) {
  const fetch = require('node-fetch');
  const res   = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch: ${url} (${res.status})`);
  const buf  = await res.buffer();
  const tmp  = path.join(os.tmpdir(), `dl-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(tmp, buf);
  return tmp;
}
```

Update `module.exports` to also export `compositePhoto`:

```js
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
```

- [ ] **Step 4.4 — Run all tests — all should pass**

```bash
npm run test:composite 2>&1
```

Expected: all tests pass including the two `compositePhoto` integration tests. Confirm no `FAIL` or `error` lines.

- [ ] **Step 4.5 — Commit**

```bash
git add src/services/composite-engine.service.js tests/composite-engine.test.js
git commit -m "feat: compositePhoto() full pipeline — EXIF, fit, borderRadius, text SVG, output"
```

---

## Task 5: BullMQ Queue + Worker

**Files:**
- Modify: `src/queues/index.js`
- Create: `src/queues/personalization.worker.js`

- [ ] **Step 5.1 — Add `personalizationQueue` to `src/queues/index.js`**

Open `src/queues/index.js`. After the `batchSetupQueue` line, add:

```js
const personalizationQueue = new Queue('personalization-composite', {
  connection,
  defaultJobOptions: {
    attempts:  3,
    backoff:   { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100, age: 86_400  },
    removeOnFail:     { count: 50,  age: 172_800 },
  },
});
```

Add `personalizationQueue` to the `module.exports`:

```js
module.exports = {
  visionQueue,
  variationQueue,
  generationQueue,
  assetQueue,
  mockupQueue,
  batchQueue,
  batchSetupQueue,
  personalizationQueue,
  defaultJobOptions,
};
```

- [ ] **Step 5.2 — Create `src/queues/personalization.worker.js`**

```js
'use strict';

/**
 * personalization.worker.js
 *
 * Processes photo personalization composite jobs.
 * Retry strategy: BullMQ-only (3 attempts, exponential backoff).
 * Status machine:
 *   PENDING → COMPOSITING → COMPOSITED  (success)
 *   PENDING → COMPOSITING → COMPOSITING (retry on transient error — BullMQ retries)
 *   PENDING → COMPOSITING → FAILED      (all retries exhausted)
 *   PENDING → FAILED                    (config error — no retry)
 */

const { Worker } = require('bullmq');
const redisConnection  = require('../config/redis');
const prisma           = require('../lib/prisma');
const { compositePhoto, validateTemplateConfig } = require('../services/composite-engine.service');

const worker = new Worker('personalization-composite', async (job) => {
  const { orderId, workspaceId } = job.data;

  // 1. Fetch order with template
  const order = await prisma.personalizationOrder.findUnique({
    where:   { id: orderId },
    include: { template: true },
  });
  if (!order) throw new Error(`Order not found: ${orderId}`);

  const template = order.template;

  // 2. Validate template config — fail fast, no retry on config errors
  try {
    validateTemplateConfig(template);
  } catch (configErr) {
    console.error(`[PersonalizationWorker] Config error on order ${orderId}: ${configErr.message}`);
    await prisma.personalizationOrder.update({
      where: { id: orderId },
      data:  { status: 'FAILED', rejectionReason: `Template config error: ${configErr.message}` },
    });
    return;  // do NOT rethrow — prevents BullMQ from retrying a config error
  }

  // 3. Fetch MockupTemplate if configured
  let mockupTemplate = null;
  if (template.mockupConfig?.mockupTemplateId) {
    mockupTemplate = await prisma.mockupTemplate.findUnique({
      where: { id: template.mockupConfig.mockupTemplateId },
    });
  }

  // 4. Mark COMPOSITING
  await prisma.personalizationOrder.update({
    where: { id: orderId },
    data:  { status: 'COMPOSITING' },
  });

  console.log(`[PersonalizationWorker] ▶ orderId:${orderId} | template:${template.name}`);

  // 5. Run composite engine (errors rethrow → BullMQ retries)
  const { printFileUrl, mockupUrl, warnings } = await compositePhoto({
    orderId,
    template,
    mockupTemplate,
    customerPhoto: order.customerPhotoUrl,
    variables:     order.variables,
    workspaceId,
  });

  // 6. Persist results
  await prisma.personalizationOrder.update({
    where: { id: orderId },
    data: {
      status:       'COMPOSITED',
      printFileUrl,
      mockupUrl,
      warnings:     warnings.length ? warnings : null,
    },
  });

  console.log(`[PersonalizationWorker] ✔ orderId:${orderId} → COMPOSITED | warnings:${warnings.join(',') || 'none'}`);
}, {
  connection:    redisConnection,
  concurrency:   1,        // Sharp is CPU-bound
  lockDuration:  120_000,  // 2 min — compositing + mockup time
  lockRenewTime: 60_000,
});

// Set FAILED after all BullMQ retries exhausted
worker.on('failed', async (job, err) => {
  if (!job) return;
  const isLastAttempt = job.attemptsMade >= (job.opts?.attempts ?? 3);
  if (isLastAttempt) {
    try {
      await prisma.personalizationOrder.update({
        where: { id: job.data.orderId },
        data:  { status: 'FAILED' },
      });
      console.error(`[PersonalizationWorker] ✗ orderId:${job.data.orderId} → FAILED after ${job.attemptsMade} attempts`);
    } catch (_) {}
  }
});

worker.on('error', (err) => {
  console.error('[PersonalizationWorker] Worker error:', err.message);
});

console.log('[PersonalizationWorker] ✔ Listening → personalization-composite (concurrency:1)');

module.exports = worker;
```

- [ ] **Step 5.3 — Commit**

```bash
git add src/queues/index.js src/queues/personalization.worker.js
git commit -m "feat: BullMQ personalization-composite queue + worker with single-mechanism retry"
```

---

## Task 6: Photo Template Routes

**Files:**
- Create: `src/routes/photo-template.routes.js`

- [ ] **Step 6.1 — Create `src/routes/photo-template.routes.js`**

```js
'use strict';

const express = require('express');
const router  = express.Router();
const prisma  = require('../lib/prisma');

// POST /api/photo-templates — create
router.post('/', async (req, res) => {
  try {
    const { name, occasion, baseArtworkUrl, photoSlot, textLayers,
            printWidthPx, printHeightPx, mockupConfig } = req.body;

    if (!name || !occasion || !baseArtworkUrl || !photoSlot || !textLayers || !printWidthPx || !printHeightPx || !mockupConfig) {
      return res.status(400).json({ error: 'Missing required fields: name, occasion, baseArtworkUrl, photoSlot, textLayers, printWidthPx, printHeightPx, mockupConfig' });
    }

    const template = await prisma.photoTemplate.create({
      data: {
        workspaceId:  req.workspaceId,
        name,
        occasion,
        baseArtworkUrl,
        photoSlot,
        textLayers,
        printWidthPx: parseInt(printWidthPx, 10),
        printHeightPx: parseInt(printHeightPx, 10),
        mockupConfig,
        active: req.body.active !== false,
      },
    });

    res.status(201).json({ success: true, template });
  } catch (err) {
    console.error('[PhotoTemplates POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/photo-templates — list active templates for workspace
router.get('/', async (req, res) => {
  try {
    const { occasion } = req.query;
    const where = { workspaceId: req.workspaceId, active: true };
    if (occasion) where.occasion = occasion;

    const templates = await prisma.photoTemplate.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json({ success: true, templates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/photo-templates/:id — single
router.get('/:id', async (req, res) => {
  try {
    const template = await prisma.photoTemplate.findFirst({
      where: { id: req.params.id, workspaceId: req.workspaceId },
    });
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json({ success: true, template });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/photo-templates/:id — update
router.patch('/:id', async (req, res) => {
  try {
    const existing = await prisma.photoTemplate.findFirst({
      where: { id: req.params.id, workspaceId: req.workspaceId },
    });
    if (!existing) return res.status(404).json({ error: 'Template not found' });

    const allowed = ['name', 'occasion', 'baseArtworkUrl', 'photoSlot', 'textLayers',
                     'printWidthPx', 'printHeightPx', 'mockupConfig', 'active'];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }

    const template = await prisma.photoTemplate.update({ where: { id: req.params.id }, data });
    res.json({ success: true, template });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 6.2 — Commit**

```bash
git add src/routes/photo-template.routes.js
git commit -m "feat: photo-template CRUD routes"
```

---

## Task 7: Personalization Order Routes

**Files:**
- Create: `src/routes/personalization.routes.js`

- [ ] **Step 7.1 — Create `src/routes/personalization.routes.js`**

```js
'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();
const prisma  = require('../lib/prisma');
const { uploadToStorage }      = require('../services/storage.service');
const { personalizationQueue } = require('../queues/index');

// Multer — temp storage, then we copy via uploadToStorage
const upload = multer({
  dest: 'uploads/temp/',
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max customer photo
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files allowed'));
    }
    cb(null, true);
  },
});

// POST /api/personalization/orders — create order + enqueue composite job
router.post('/orders', upload.single('customerPhoto'), async (req, res) => {
  try {
    const { templateId, variables: variablesRaw, etsyOrderRef } = req.body;

    if (!templateId)     return res.status(400).json({ error: 'templateId required' });
    if (!req.file)       return res.status(400).json({ error: 'customerPhoto file required' });

    // Parse variables JSON string
    let variables = {};
    if (variablesRaw) {
      try { variables = JSON.parse(variablesRaw); } catch (_) {
        return res.status(400).json({ error: 'variables must be a valid JSON string' });
      }
    }

    // Verify template exists and belongs to workspace
    const template = await prisma.photoTemplate.findFirst({
      where: { id: templateId, workspaceId: req.workspaceId, active: true },
    });
    if (!template) return res.status(404).json({ error: 'PhotoTemplate not found' });

    // Persist customer photo to assets/uploads/personalization/customer-photos/
    const ext       = path.extname(req.file.originalname) || '.jpg';
    const filename  = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const storePath = `personalization/customer-photos/${filename}`;
    const photoUrl  = await uploadToStorage(req.file.path, storePath);
    // Clean up multer temp file
    try { fs.unlinkSync(req.file.path); } catch (_) {}

    // Create order
    const order = await prisma.personalizationOrder.create({
      data: {
        workspaceId:    req.workspaceId,
        templateId,
        customerPhotoUrl: photoUrl,
        variables,
        etsyOrderRef:   etsyOrderRef || null,
        status:         'PENDING',
      },
    });

    // Enqueue composite job
    await personalizationQueue.add('composite', {
      orderId:     order.id,
      workspaceId: req.workspaceId,
    });

    res.status(201).json({ success: true, order });
  } catch (err) {
    console.error('[Personalization POST /orders]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/personalization/orders?status= — list orders
router.get('/orders', async (req, res) => {
  try {
    const { status, limit = '50', offset = '0' } = req.query;
    const where = { workspaceId: req.workspaceId };
    if (status) where.status = status.toUpperCase();

    const orders = await prisma.personalizationOrder.findMany({
      where,
      include: { template: { select: { name: true, occasion: true } } },
      orderBy: { createdAt: 'desc' },
      take:    Math.min(parseInt(limit, 10) || 50, 100),
      skip:    parseInt(offset, 10) || 0,
    });

    res.json({ success: true, orders, count: orders.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/personalization/orders/:id — single order
router.get('/orders/:id', async (req, res) => {
  try {
    const order = await prisma.personalizationOrder.findFirst({
      where:   { id: req.params.id, workspaceId: req.workspaceId },
      include: { template: true },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/personalization/orders/:id/approve
router.post('/orders/:id/approve', async (req, res) => {
  try {
    const order = await prisma.personalizationOrder.findFirst({
      where: { id: req.params.id, workspaceId: req.workspaceId },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'COMPOSITED') {
      return res.status(400).json({ error: `Cannot approve order with status ${order.status}. Expected COMPOSITED.` });
    }

    const updated = await prisma.personalizationOrder.update({
      where: { id: req.params.id },
      data:  { status: 'APPROVED' },
    });
    res.json({ success: true, order: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/personalization/orders/:id/reject
router.post('/orders/:id/reject', async (req, res) => {
  try {
    const order = await prisma.personalizationOrder.findFirst({
      where: { id: req.params.id, workspaceId: req.workspaceId },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!['COMPOSITED', 'PENDING', 'COMPOSITING'].includes(order.status)) {
      return res.status(400).json({ error: `Cannot reject order with status ${order.status}` });
    }

    const updated = await prisma.personalizationOrder.update({
      where: { id: req.params.id },
      data:  { status: 'REJECTED', rejectionReason: req.body.reason || null },
    });
    res.json({ success: true, order: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 7.2 — Commit**

```bash
git add src/routes/personalization.routes.js
git commit -m "feat: personalization order routes (create, list, detail, approve, reject)"
```

---

## Task 8: Register Routes + Worker in `src/index.js`

**Files:**
- Modify: `src/index.js`

- [ ] **Step 8.1 — Mount routes**

In `src/index.js`, find the block that ends with:
```js
app.use('/api/styles', generalLimiter, require('./routes/style.routes'));
```

Add these two lines immediately after:

```js
app.use('/api/photo-templates',  generalLimiter, require('./routes/photo-template.routes'));
app.use('/api/personalization',  generalLimiter, require('./routes/personalization.routes'));
```

- [ ] **Step 8.2 — Register worker**

In `src/index.js`, find the worker initialization block (around line 465):
```js
    require('./queues/asset.worker');
    require('./queues/mockup.worker');
    require('./queues/knowledge.worker');
    require('./queues/batch.worker');
    console.log('[Workers] Asset, Mockup, Knowledge ve Batch başlatıldı.');
```

Add the personalization worker and update the log line:
```js
    require('./queues/asset.worker');
    require('./queues/mockup.worker');
    require('./queues/knowledge.worker');
    require('./queues/batch.worker');
    require('./queues/personalization.worker');
    console.log('[Workers] Asset, Mockup, Knowledge, Batch ve Personalization başlatıldı.');
```

- [ ] **Step 8.3 — Restart backend and verify routes registered**

```bash
curl -s http://localhost:3001/health
```

Then check the backend log for:
```
[PersonalizationWorker] ✔ Listening → personalization-composite (concurrency:1)
```

Also verify routes respond (no auth = 401, not 404):
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/photo-templates
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/personalization/orders
```

Expected: both return `401` (workspace middleware rejects unauthenticated) — not `404`.

- [ ] **Step 8.4 — Commit**

```bash
git add src/index.js
git commit -m "feat: register personalization routes and worker in Express app"
```

---

## Task 9: Seed Script

**Files:**
- Create: `scripts/seed-birthday-template.js`

- [ ] **Step 9.1 — Create `scripts/seed-birthday-template.js`**

```js
'use strict';

/**
 * Seed script: creates the birthday PhotoTemplate with a Sharp-generated base artwork.
 * No Fal.ai required.
 *
 * Usage:
 *   node scripts/seed-birthday-template.js
 *
 * Reads workspaceId from DB (first workspace found).
 * Safe to re-run — checks for existing template by name before creating.
 */

require('dotenv').config();
const sharp  = require('sharp');
const path   = require('path');
const fs     = require('fs');
const prisma = require('../src/lib/prisma');

const ASSETS_ROOT = path.join(__dirname, '../assets');
const PRINT_W = 1200, PRINT_H = 1440;

async function main() {
  // 1. Find workspace
  const workspace = await prisma.workspace.findFirst();
  if (!workspace) {
    console.error('No workspace found. Start the app and log in first to create one.');
    process.exit(1);
  }
  console.log(`Using workspace: ${workspace.name} (${workspace.id})`);

  // 2. Check if template already exists
  const existing = await prisma.photoTemplate.findFirst({
    where: { workspaceId: workspace.id, name: 'Vintage Birthday Photo Shirt' },
  });
  if (existing) {
    console.log(`Template already exists: ${existing.id}`);
    console.log('Seed complete (no-op).');
    return;
  }

  // 3. Generate base artwork with Sharp
  //    Golden gradient background + dark circular border hint
  const photoSlotX = 300, photoSlotY = 180, photoSlotSize = 600;

  const baseBuffer = await sharp({
    create: { width: PRINT_W, height: PRINT_H, channels: 3, background: { r: 212, g: 175, b: 55 } },
  })
  .composite([
    // Darker golden frame ring around photo slot area
    {
      input: Buffer.from(
        `<svg width="${PRINT_W}" height="${PRINT_H}" xmlns="http://www.w3.org/2000/svg">
          <circle cx="${photoSlotX + photoSlotSize/2}" cy="${photoSlotY + photoSlotSize/2}"
                  r="${photoSlotSize/2 + 20}" fill="none" stroke="#8B6914" stroke-width="12"/>
        </svg>`
      ),
      blend: 'over',
    },
  ])
  .png()
  .toBuffer();

  // 4. Persist base artwork
  const artworkDir = path.join(ASSETS_ROOT, 'uploads', 'photo-templates');
  if (!fs.existsSync(artworkDir)) fs.mkdirSync(artworkDir, { recursive: true });
  const artworkFilename = 'birthday-vintage-base.png';
  const artworkPath     = path.join(artworkDir, artworkFilename);
  fs.writeFileSync(artworkPath, baseBuffer);
  const baseArtworkUrl = `assets/uploads/photo-templates/${artworkFilename}`;
  console.log(`Base artwork saved → ${baseArtworkUrl}`);

  // 5. Create PhotoTemplate
  const template = await prisma.photoTemplate.create({
    data: {
      workspaceId:   workspace.id,
      name:          'Vintage Birthday Photo Shirt',
      occasion:      'birthday',
      baseArtworkUrl,
      photoSlot: {
        x: photoSlotX, y: photoSlotY,
        width: photoSlotSize, height: photoSlotSize,
        fit: 'cover', align: 'center',
        borderRadius: 300,  // circle
        rotation: 0,
      },
      textLayers: [
        {
          key: 'name', x: 600, y: 880,
          font: 'Montserrat-Bold', size: 64,
          color: '#FFFFFF', align: 'center',
          maxWidth: 700, transform: 'uppercase',
        },
        {
          key: 'year', x: 600, y: 960,
          font: 'Montserrat-Regular', size: 48,
          color: '#FFD700', align: 'center',
          maxWidth: 500, transform: null,
        },
      ],
      printWidthPx:  PRINT_W,
      printHeightPx: PRINT_H,
      mockupConfig:  { mockupTemplateId: null },
      active: true,
    },
  });

  console.log(`✅ Birthday template created: ${template.id}`);
  console.log(`   Name: ${template.name}`);
  console.log(`   photoSlot: ${template.photoSlotSize || photoSlotSize}px circle`);
  console.log(`   printSize: ${PRINT_W}×${PRINT_H}px`);
}

main()
  .catch(err => { console.error(err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 9.2 — Run seed script**

```bash
cd C:\Users\Anılcan\Desktop\pod-ai-factory
node scripts/seed-birthday-template.js
```

Expected output:
```
Using workspace: <name> (<id>)
Base artwork saved → assets/uploads/photo-templates/birthday-vintage-base.png
✅ Birthday template created: <uuid>
   Name: Vintage Birthday Photo Shirt
   printSize: 1200×1440px
```

- [ ] **Step 9.3 — Verify artwork file exists**

```bash
ls -lh assets/uploads/photo-templates/birthday-vintage-base.png
```

Expected: file present, ~50-200 KB.

- [ ] **Step 9.4 — Commit**

```bash
git add scripts/seed-birthday-template.js assets/uploads/photo-templates/
git commit -m "feat: seed script for birthday PhotoTemplate with Sharp-generated base artwork"
```

---

## Task 10: Acceptance Test

Run the 4-step acceptance test end-to-end using curl. Requires the backend to be running (`npm run dev:backend`).

- [ ] **Step 10.1 — Get session cookie**

```bash
curl -s -c /tmp/cookies.txt -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpassword"}' | python -m json.tool
```

Expected: `{ "user": { ... } }` — cookie saved to `/tmp/cookies.txt`.

- [ ] **Step 10.2 — Get templateId**

```bash
curl -s -b /tmp/cookies.txt http://localhost:3001/api/photo-templates | python -m json.tool
```

Copy the `id` of the `"Vintage Birthday Photo Shirt"` template. Set in shell:

```bash
TEMPLATE_ID=<paste-uuid-here>
```

- [ ] **Step 10.3 — Create a test JPEG (if you don't have one)**

```bash
node -e "
const sharp = require('sharp');
sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 100, g: 150, b: 200 } } })
  .jpeg().toFile('/tmp/test-customer.jpg', (err) => { if (err) throw err; console.log('Created /tmp/test-customer.jpg'); });
"
```

- [ ] **Step 10.4 — POST /api/personalization/orders (Acceptance Test Step 1)**

```bash
ORDER=$(curl -s -b /tmp/cookies.txt \
  -X POST http://localhost:3001/api/personalization/orders \
  -F "templateId=$TEMPLATE_ID" \
  -F "variables={\"name\":\"Emma\",\"year\":\"1996\"}" \
  -F "customerPhoto=@/tmp/test-customer.jpg")
echo $ORDER | python -m json.tool
ORDER_ID=$(echo $ORDER | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.parse(d).order.id))")
echo "ORDER_ID=$ORDER_ID"
```

Expected: `order.status = "PENDING"`, HTTP 201.

- [ ] **Step 10.5 — Wait for worker and verify COMPOSITED (Acceptance Test Step 2 + 3)**

Wait ~5 seconds for the worker to process, then:

```bash
curl -s -b /tmp/cookies.txt \
  "http://localhost:3001/api/personalization/orders?status=composited" | python -m json.tool
```

Expected: order appears with `printFileUrl` populated. If test photo (400×400) is smaller than slot (600×600), `warnings` will include `"low_resolution"`.

Also verify the print file exists on disk:

```bash
PRINT_URL=$(curl -s -b /tmp/cookies.txt http://localhost:3001/api/personalization/orders/$ORDER_ID | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.parse(d).order.printFileUrl))")
echo "Print file: $PRINT_URL"
ls -lh "$PRINT_URL"
```

Verify dimensions:
```bash
node -e "
const sharp = require('sharp');
sharp('$PRINT_URL').metadata().then(m => {
  console.log('Dimensions:', m.width, '×', m.height);
  console.assert(m.width === 1200 && m.height === 1440, 'WRONG dimensions!');
  console.log('✅ Dimensions correct: 1200×1440');
});
"
```

- [ ] **Step 10.6 — Approve order (Acceptance Test Step 4)**

```bash
curl -s -b /tmp/cookies.txt \
  -X POST http://localhost:3001/api/personalization/orders/$ORDER_ID/approve | python -m json.tool
```

Expected: `order.status = "APPROVED"`, HTTP 200.

- [ ] **Step 10.7 — Final unit test run (regression check)**

```bash
npm run test:composite 2>&1
```

Expected: all tests still pass.

- [ ] **Step 10.8 — Final commit**

```bash
git add .
git commit -m "feat: photo personalization composite engine MVP — acceptance test passing"
```

---

## Self-Review Checklist

- [x] **§4.1 compositePhoto()** → Task 4 implements full pipeline
- [x] **§4.2 Worker BullMQ-only retry + FAILED enum** → Task 5 (no PENDING revert, `failed` event sets FAILED)
- [x] **§4.3 Font bundle strategy** → Task 2 (download) + Task 3/4 (`FONT_REGISTRY`, `loadFontB64`, base64 embed in SVG)
- [x] **§4.4 maxWidth conditional textLength** → Task 3 (`buildTextSvg` with `estimateTextWidth` guard), unit tests in Step 3.2
- [x] **§6.5 Slot-relative resolution check** → Task 4, `meta.width < slot.width || meta.height < slot.height`
- [x] **§8 All 9 endpoints** → Tasks 6, 7 (photo-template CRUD + order CRUD + approve/reject)
- [x] **§9 Birthday seed** → Task 9 (Sharp-generated base, no Fal.ai)
- [x] **§10 Acceptance test** → Task 10 (4 curl steps)
- [x] **No Supabase** → `uploadToStorage()` throughout
- [x] **No new heavy deps** → Pure Sharp + SVG, `node:test`
- [x] **Type consistency**: `compositePhoto()` signature used identically in Task 4 (service), Task 5 (worker call), and Task 10 tests (`orderId, template, mockupTemplate, customerPhoto, variables, workspaceId`)
