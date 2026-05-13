# Mockup Bulk Import & PSD Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Creative Fabrica'dan indirilen PNG/JPG/PSD mockupları toplu sisteme aktarmak; PSD'den smart object bounds → kesin print area, shadow katmanı çıkarma, greyscale base via Sharp tint ile tişört rengi değiştirme.

**Architecture:** Yeni `psd-analyzer.service.js` PSD'yi parse eder, 4 dosya üretir (base.png, gray_base.png, shadow.png, config.json). `bulk-upload` route'u PSD dalını tetikler. `mockup-render.service.js` `productColor` parametresiyle grayBasePath üzerinden tint uygular. `BulkUploadModal` yerinde yükseltilir (PSD + 100 dosya + batch). Renk picker ve AI shadow butonu MockupsClient.tsx'e eklenir.

**Tech Stack:** Node.js/Express, `psd` npm (psd.js), Sharp, FAL.ai (`fal-ai/imageutils/depth`), Next.js 14, TanStack Query, Tailwind CSS

---

## Dosya Haritası

| Eylem | Dosya | Ne değişiyor |
|-------|-------|--------------|
| Oluştur | `scripts/create-preset-shadows.js` | Preset shadow PNG'leri üretir |
| Oluştur | `assets/presets/shadows/*.png` | 6 kategori preset shadow |
| Oluştur | `src/services/psd-analyzer.service.js` | PSD parse, layer analiz |
| Değiştir | `src/routes/mockup-template.routes.js` | bulk-upload PSD dalı + generate-shadow route |
| Değiştir | `src/services/mockup-render.service.js` | productColor tint + hexToRgb |
| Değiştir | `frontend/lib/api.ts` | productColor tipler, generateShadow, bulkUpload fonksiyonları |
| Değiştir | `frontend/app/dashboard/mockups/MockupsClient.tsx` | BulkUploadModal yükseltme, renk picker, AI shadow butonu |

---

## Task 1: `psd` Paketi + Preset Shadow'lar

**Files:**
- Create: `scripts/create-preset-shadows.js`
- Create: `assets/presets/shadows/` (6 PNG)

- [ ] **Step 1: `psd` paketini kur**

```bash
cd "C:\Users\Anılcan\Desktop\pod-ai-factory"
npm install psd
```

Beklenen çıktı: `added 1 package` (veya benzeri)

- [ ] **Step 2: Preset shadow script oluştur**

`scripts/create-preset-shadows.js`:

```js
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '../assets/presets/shadows');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const PRESETS = [
    { name: 'tshirt',      w: 800,  h: 1000 },
    { name: 'hoodie',      w: 800,  h: 1000 },
    { name: 'sweatshirt',  w: 800,  h: 1000 },
    { name: 'mug',         w: 800,  h: 800  },
    { name: 'sticker',     w: 800,  h: 800  },
    { name: 'phone_case',  w: 600,  h: 1000 },
];

async function makeShadow({ name, w, h }) {
    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <radialGradient id="vignette" cx="50%" cy="50%" r="65%">
                <stop offset="0%"   stop-color="black" stop-opacity="0"/>
                <stop offset="55%"  stop-color="black" stop-opacity="0"/>
                <stop offset="100%" stop-color="black" stop-opacity="0.28"/>
            </radialGradient>
            <linearGradient id="topfold" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"  stop-color="black" stop-opacity="0.10"/>
                <stop offset="12%" stop-color="black" stop-opacity="0"/>
            </linearGradient>
            <linearGradient id="botfold" x1="0" y1="0" x2="0" y2="1">
                <stop offset="88%" stop-color="black" stop-opacity="0"/>
                <stop offset="100%" stop-color="black" stop-opacity="0.12"/>
            </linearGradient>
        </defs>
        <rect width="${w}" height="${h}" fill="url(#vignette)"/>
        <rect width="${w}" height="${h}" fill="url(#topfold)"/>
        <rect width="${w}" height="${h}" fill="url(#botfold)"/>
    </svg>`;

    await sharp(Buffer.from(svg))
        .png()
        .toFile(path.join(OUT, `${name}_shadow.png`));

    console.log(`✓ ${name}_shadow.png`);
}

(async () => {
    for (const p of PRESETS) await makeShadow(p);
    console.log('All preset shadows created in assets/presets/shadows/');
})();
```

- [ ] **Step 3: Script çalıştır**

```bash
node scripts/create-preset-shadows.js
```

Beklenen: `✓ tshirt_shadow.png ... All preset shadows created`

- [ ] **Step 4: Commit**

```bash
git add scripts/create-preset-shadows.js assets/presets/shadows/
git commit -m "feat: add psd package and preset shadow overlays"
```

---

## Task 2: `psd-analyzer.service.js`

**Files:**
- Create: `src/services/psd-analyzer.service.js`

- [ ] **Step 1: Servis dosyasını oluştur**

`src/services/psd-analyzer.service.js`:

```js
const PSD = require('psd');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { detectPrintArea } = require('./mockup-render.service');

const SMART_KEYWORDS = ['design', 'artwork', 'place', 'your', 'motif', 'print', 'grafik', 'tasarim', 'tasarım', 'smartobject'];
const SHADOW_KEYWORDS = ['shadow', 'highlight', 'shading', 'overlay', 'wrinkle', 'fold', 'texture', 'gölge', 'doku'];

function flattenLayers(nodes) {
    const result = [];
    for (const node of nodes) {
        result.push(node);
        if (node.isGroup() && node.children && node.children().length) {
            result.push(...flattenLayers(node.children()));
        }
    }
    return result;
}

function findLayer(layers, keywords) {
    return layers.find(l => {
        const name = (l.name || '').toLowerCase().replace(/\s+/g, '');
        return keywords.some(k => name.includes(k));
    }) || null;
}

function boundsToNormalized(coords, psdWidth, psdHeight) {
    const { top, left, bottom, right } = coords;
    const x = left / psdWidth;
    const y = top / psdHeight;
    const w = (right - left) / psdWidth;
    const h = (bottom - top) / psdHeight;
    return {
        x: parseFloat(Math.max(0, x).toFixed(4)),
        y: parseFloat(Math.max(0, y).toFixed(4)),
        width: parseFloat(Math.min(1 - x, w).toFixed(4)),
        height: parseFloat(Math.min(1 - y, h).toFixed(4)),
    };
}

async function renderLayerToPng(layer, psdWidth, psdHeight) {
    try {
        const rawBuf = layer.image.toBuffer();
        if (!rawBuf || rawBuf.byteLength === 0) return null;

        const lw = layer.layer.width || layer.width;
        const lh = layer.layer.height || layer.height;
        if (!lw || !lh) return null;

        const coords = layer.layer.coords || {};
        const left = coords.left || 0;
        const top = coords.top || 0;

        // Layer pixel data → PNG buffer
        const layerPng = await sharp(Buffer.from(rawBuf), {
            raw: { width: lw, height: lh, channels: 4 }
        }).png().toBuffer();

        // Place layer on full-canvas-sized transparent image
        const fullCanvas = await sharp({
            create: { width: psdWidth, height: psdHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
        })
            .composite([{ input: layerPng, left: Math.max(0, left), top: Math.max(0, top) }])
            .png()
            .toBuffer();

        return fullCanvas;
    } catch {
        return null;
    }
}

/**
 * Analyze a PSD file and return extracted assets.
 * @param {string} psdFilePath  Absolute path to the .psd file
 * @param {string} category     Template category (for preset shadow fallback)
 * @returns {{ printArea, baseBuffer, grayBuffer, shadowBuffer, defaultColor, layerMap }}
 */
async function analyze(psdFilePath, category = 'tshirt') {
    const psd = PSD.fromFile(psdFilePath);
    psd.parse();

    const psdWidth = psd.header.width;
    const psdHeight = psd.header.height;
    const allLayers = flattenLayers(psd.tree().children());

    // 1. Smart object → print area
    const smartLayer = findLayer(allLayers, SMART_KEYWORDS);
    let printArea;
    let smartLayerName = null;

    if (smartLayer) {
        const coords = smartLayer.layer?.coords || smartLayer.get?.('bounds') || {};
        const valid = typeof coords.top === 'number' && typeof coords.left === 'number'
            && typeof coords.bottom === 'number' && typeof coords.right === 'number'
            && (coords.right - coords.left) > 0 && (coords.bottom - coords.top) > 0;

        if (valid) {
            printArea = boundsToNormalized(coords, psdWidth, psdHeight);
            smartLayerName = smartLayer.name;
        }
    }

    if (!printArea) {
        // Fallback: write flattened PSD to temp then detect
        const tmpPath = path.join(os.tmpdir(), `psd-detect-${Date.now()}.png`);
        await psd.image.saveAsPng(tmpPath);
        printArea = await detectPrintArea(tmpPath);
        try { fs.unlinkSync(tmpPath); } catch {}
    }

    // 2. Full flatten → base buffer
    const baseTmp = path.join(os.tmpdir(), `psd-base-${Date.now()}.png`);
    await psd.image.saveAsPng(baseTmp);
    const baseBuffer = fs.readFileSync(baseTmp);
    try { fs.unlinkSync(baseTmp); } catch {}

    // 3. Greyscale → gray_base buffer
    const grayBuffer = await sharp(baseBuffer)
        .greyscale()
        .png()
        .toBuffer();

    // 4. Shadow layer
    const shadowLayer = findLayer(allLayers, SHADOW_KEYWORDS);
    let shadowBuffer = null;
    let shadowLayerName = null;

    if (shadowLayer) {
        shadowBuffer = await renderLayerToPng(shadowLayer, psdWidth, psdHeight);
        if (shadowBuffer) shadowLayerName = shadowLayer.name;
    }

    // 5. Default color (best-effort — falls back to white)
    const defaultColor = '#FFFFFF';

    return {
        printArea,
        baseBuffer,
        grayBuffer,
        shadowBuffer,
        defaultColor,
        layerMap: {
            smartObject: smartLayerName,
            shadow: shadowLayerName,
        },
    };
}

module.exports = { analyze };
```

- [ ] **Step 2: Hızlı smoke test**

`scripts/test-psd-analyzer.js` oluştur:

```js
const path = require('path');
const { analyze } = require('../src/services/psd-analyzer.service');

const psdPath = process.argv[2];
if (!psdPath) { console.error('Usage: node test-psd-analyzer.js path/to/file.psd'); process.exit(1); }

analyze(path.resolve(psdPath), 'tshirt').then(result => {
    console.log('printArea:', result.printArea);
    console.log('defaultColor:', result.defaultColor);
    console.log('layerMap:', result.layerMap);
    console.log('baseBuffer size:', result.baseBuffer.length);
    console.log('grayBuffer size:', result.grayBuffer.length);
    console.log('shadowBuffer:', result.shadowBuffer ? result.shadowBuffer.length + ' bytes' : 'null (will use preset)');
}).catch(err => console.error('ERROR:', err.message));
```

Çalıştır (elinizde bir PSD varsa):
```bash
node scripts/test-psd-analyzer.js "C:\path\to\your.psd"
```

Beklenen: printArea değerleri 0-1 arası, baseBuffer/grayBuffer non-zero

- [ ] **Step 3: Commit**

```bash
git add src/services/psd-analyzer.service.js scripts/test-psd-analyzer.js
git commit -m "feat: add psd-analyzer service — smart object bounds, shadow layer extraction, grayscale base"
```

---

## Task 3: `mockup-template.routes.js` — PSD Desteği + generate-shadow Route

**Files:**
- Modify: `src/routes/mockup-template.routes.js`

- [ ] **Step 1: `require` ekle ve fileFilter'ı güncelle (satır 1-56)**

Dosyanın en üstüne, mevcut require'ların altına ekle:

```js
const { analyze: analyzePsd } = require('../services/psd-analyzer.service');
```

`fileFilter` fonksiyonunu güncelle (mevcut satır ~51-55):

```js
    fileFilter: (req, file, cb) => {
        const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.webm', '.mov', '.psd'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error(`File type ${ext} not allowed. Use: ${allowed.join(', ')}`));
    }
```

- [ ] **Step 2: `bulk-upload` route'unu güncelle (satır ~367 başlayan `router.post('/bulk-upload')`)**

`upload.array('images', 20)` → `upload.array('images', 100)` olarak değiştir:

```js
        await new Promise((resolve, reject) => {
            upload.array('images', 100)(req, res, err => err ? reject(err) : resolve());
        });
```

`fileFilter` içindeki `if (file.mimetype.startsWith('image/')) cb(null, true);` satırını güncelle:

```js
        fileFilter: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            if (file.mimetype.startsWith('image/') || ext === '.psd') cb(null, true);
            else cb(new Error('Images and PSD only'));
        },
```

Dosya işleme döngüsünü şu şekilde güncelle — mevcut `for (const file of files)` bloğunu değiştir:

```js
        for (const file of files) {
            try {
                const templateId = require('crypto').randomUUID();
                const isPsd = path.extname(file.originalname).toLowerCase() === '.psd';
                const destDir = path.join(__dirname, `../../assets/mockups/${category}/${templateId}`);
                fs.mkdirSync(destDir, { recursive: true });

                let printArea, baseImageFilename, shadowImagePath, configMeta;

                if (isPsd) {
                    // PSD analiz
                    const analysis = await analyzePsd(file.path, category);

                    // base.png
                    baseImageFilename = 'base.png';
                    fs.writeFileSync(path.join(destDir, 'base.png'), analysis.baseBuffer);

                    // gray_base.png
                    fs.writeFileSync(path.join(destDir, 'gray_base.png'), analysis.grayBuffer);

                    // shadow: PSD'den geldiyse kaydet, yoksa preset yolu
                    if (analysis.shadowBuffer) {
                        fs.writeFileSync(path.join(destDir, 'shadow.png'), analysis.shadowBuffer);
                        shadowImagePath = `assets/mockups/${category}/${templateId}/shadow.png`;
                    } else {
                        shadowImagePath = `assets/presets/shadows/${category}_shadow.png`;
                    }

                    printArea = analysis.printArea;
                    configMeta = {
                        grayBasePath: `assets/mockups/${category}/${templateId}/gray_base.png`,
                        defaultColor: analysis.defaultColor,
                        isPsdDerived: true,
                        shadowSource: analysis.shadowBuffer ? 'psd' : 'preset',
                        layerMap: analysis.layerMap,
                    };
                } else {
                    // PNG/JPG: mevcut akış
                    const ext = path.extname(file.originalname);
                    baseImageFilename = `base${ext}`;
                    const destPath = path.join(destDir, baseImageFilename);
                    fs.copyFileSync(file.path, destPath);
                    shadowImagePath = null;

                    const printAreaResult = await detectPrintArea(file.path);
                    printArea = {
                        x: printAreaResult.x,
                        y: printAreaResult.y,
                        width: printAreaResult.width,
                        height: printAreaResult.height,
                    };
                    configMeta = {
                        view: 'front', background: 'studio', color: 'white', hasHumanModel: false,
                        isPsdDerived: false,
                    };
                }

                const template = await prisma.mockupTemplate.create({
                    data: {
                        id: templateId,
                        workspaceId: req.workspaceId,
                        name: path.basename(file.originalname, path.extname(file.originalname)),
                        category,
                        baseImagePath: `assets/mockups/${category}/${templateId}/${baseImageFilename}`,
                        shadowImagePath,
                        configJson: {
                            printArea,
                            transform: { rotation: 0, opacity: isPsd ? 0.92 : 1, blendMode: 'multiply' },
                            render: { renderMode: 'flat' },
                            meta: configMeta,
                        },
                    },
                });

                results.push({
                    id: template.id,
                    name: template.name,
                    printArea,
                    confidence: isPsd ? 100 : (printAreaResult?.confidence ?? 70),
                    type: isPsd ? 'psd' : 'image',
                    shadowSource: isPsd ? configMeta.shadowSource : null,
                    status: 'success',
                });

            } catch (err) {
                results.push({ name: file.originalname, status: 'error', error: err.message });
            }
        }
```

**Not:** Mevcut `for` döngüsünde kullanılan `const { sharp } = require('sharp')` satırını kaldır; `sharp` zaten en üstte `require` edilmiş.

- [ ] **Step 3: `generate-shadow` route ekle — `/api/mockups/templates/:id/generate-shadow`**

`module.exports = router;` satırından hemen önce ekle:

```js
// POST /api/mockups/templates/:id/generate-shadow
router.post('/:id/generate-shadow', async (req, res) => {
    try {
        if (!req.workspaceId) return res.status(401).json({ error: 'Unauthorized' });

        const template = await prisma.mockupTemplate.findFirst({
            where: { id: req.params.id, workspaceId: req.workspaceId },
        });
        if (!template) return res.status(404).json({ error: 'Template not found' });

        const basePath = path.isAbsolute(template.baseImagePath)
            ? template.baseImagePath
            : path.join(__dirname, '../../', template.baseImagePath);

        if (!fs.existsSync(basePath)) {
            return res.status(400).json({ error: 'Base image not found' });
        }

        // Upload base to get public URL (FAL.ai can't reach local files)
        const { uploadToStorage } = require('../services/storage.service');
        const storagePath = `tmp/shadow-gen-${Date.now()}.png`;
        const publicUrl = await uploadToStorage(basePath, storagePath);

        const { fal } = require('@fal-ai/client');
        const result = await fal.subscribe('fal-ai/imageutils/depth', {
            input: { image_url: publicUrl },
        });

        const depthUrl = result?.data?.image?.url || result?.image?.url;
        if (!depthUrl) return res.status(500).json({ error: 'Depth model returned no output' });

        // Depth map → invert + blur → shadow overlay
        const fetch = require('node-fetch');
        const depthRes = await fetch(depthUrl);
        const depthBuffer = Buffer.from(await depthRes.arrayBuffer());

        const shadowBuffer = await sharp(depthBuffer)
            .negate()                   // invert: near=bright → near=dark
            .blur(3)                    // soft edges
            .ensureAlpha()
            .modulate({ brightness: 0.4 }) // dim → subtle overlay
            .png()
            .toBuffer();

        // Save
        const templateDir = path.dirname(basePath);
        const shadowPath = path.join(templateDir, 'shadow_ai.png');
        fs.writeFileSync(shadowPath, shadowBuffer);

        const shadowImagePath = template.baseImagePath.replace(/[^/]+$/, 'shadow_ai.png');
        const updatedTemplate = await prisma.mockupTemplate.update({
            where: { id: template.id },
            data: {
                shadowImagePath,
                configJson: {
                    ...template.configJson,
                    meta: {
                        ...(template.configJson?.meta || {}),
                        shadowSource: 'ai',
                    },
                },
            },
        });

        res.json({ success: true, shadowImagePath, template: updatedTemplate });
    } catch (err) {
        console.error('[generate-shadow]', err.message);
        res.status(500).json({ error: err.message });
    }
});
```

- [ ] **Step 4: Curl ile smoke test**

Backend'i başlatın (`npm run dev:backend`), ardından:

```bash
curl -X POST http://localhost:3001/api/mockups/templates/bulk-upload \
  -H "Cookie: <session-cookie>" \
  -F "images=@C:/path/to/test.psd" \
  -F "category=tshirt"
```

Beklenen yanıt:
```json
{"results":[{"id":"...","name":"test","printArea":{"x":0.35,"y":0.24,...},"type":"psd","shadowSource":"preset","status":"success"}],"total":1,"success":1}
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/mockup-template.routes.js
git commit -m "feat: bulk-upload PSD support — psd-analyzer integration, 100 file limit, generate-shadow route"
```

---

## Task 4: `mockup-render.service.js` — `productColor` Tint

**Files:**
- Modify: `src/services/mockup-render.service.js`

- [ ] **Step 1: `hexToRgb` yardımcısını ekle**

`module.exports` satırından hemen önce ekle:

```js
function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    if (clean.length !== 6) return { r: 255, g: 255, b: 255 };
    return {
        r: parseInt(clean.slice(0, 2), 16),
        g: parseInt(clean.slice(2, 4), 16),
        b: parseInt(clean.slice(4, 6), 16),
    };
}
```

- [ ] **Step 2: `renderMockup` imzasına `productColor` ekle**

Mevcut satır (yaklaşık satır 50):
```js
async function renderMockup({ designPath, template, imageId, workspaceId, placement, areaDesigns }) {
```

Şu şekilde güncelle:
```js
async function renderMockup({ designPath, template, imageId, workspaceId, placement, areaDesigns, productColor }) {
```

- [ ] **Step 3: Base yükleme öncesine tint bloğu ekle**

Mevcut satır 70-84 (base path çözümleme + metadata alma bloğu):

```js
    const basePath = path.isAbsolute(template.baseImagePath)
        ? template.baseImagePath
        : path.join(ASSETS_ROOT, '..', template.baseImagePath);
```

Bu satırdan **hemen sonra** şunu ekle:

```js
    // productColor: gray_base.png → tint → temp file → basePath olarak kullan
    let effectiveBasePath = basePath;
    let tintTmpFile = null;

    const grayBasePath = template.configJson?.meta?.grayBasePath;
    if (productColor && grayBasePath) {
        const grayFullPath = path.isAbsolute(grayBasePath)
            ? grayBasePath
            : path.join(ASSETS_ROOT, '..', grayBasePath);

        if (fs.existsSync(grayFullPath)) {
            const { r, g, b } = hexToRgb(productColor);
            tintTmpFile = path.join(os.tmpdir(), `tinted-${Date.now()}.png`);
            await sharp(grayFullPath)
                .tint({ r, g, b })
                .png()
                .toFile(tintTmpFile);
            effectiveBasePath = tintTmpFile;
            console.log(`[Render] productColor ${productColor} applied via tint → ${tintTmpFile}`);
        }
    }
```

- [ ] **Step 4: `basePath` referanslarını `effectiveBasePath` ile değiştir**

`renderMockup` fonksiyonu içinde `basePath` kullanılan yerleri `effectiveBasePath` olarak güncelle. Bunlar:
- `sharp(basePath).metadata()` → `sharp(effectiveBasePath).metadata()`
- `ffprobe(basePath)` → `ffprobe(effectiveBasePath)` (video path)
- `await sharp(basePath).composite(...)` (render step, satır ~332) → `await sharp(effectiveBasePath).composite(...)`
- `await sharp(basePath).greyscale()...` (brightness analysis, satır ~198) → `await sharp(effectiveBasePath).greyscale()...`

- [ ] **Step 5: Geçici dosyayı temizle**

`tmpFiles.forEach(f => { ... })` satırının hemen altına (satır ~336) ekle:

```js
    if (tintTmpFile) {
        try { fs.unlinkSync(tintTmpFile); } catch {}
    }
```

- [ ] **Step 6: `module.exports` güncelle**

```js
module.exports = { renderMockup, detectPrintArea, hexToRgb };
```

- [ ] **Step 7: Commit**

```bash
git add src/services/mockup-render.service.js
git commit -m "feat: renderMockup productColor param — gray_base.png + Sharp tint for shirt color change"
```

---

## Task 5: `frontend/lib/api.ts` — Yeni Tipler ve Fonksiyonlar

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: `render` ve `renderBatch` fonksiyonlarına `productColor` ekle**

Mevcut `render` fonksiyonu (satır ~360):
```ts
    render: (imageId: string, templateId: string, placement?: { scale: number; offsetX: number; offsetY: number; rotation: number }, areaDesigns?: Record<string, { imageId: string; imageUrl: string }>) =>
        request<MockupRecord>('/mockups/render', {
            method: 'POST',
            body: JSON.stringify({ imageId, templateId, placement, areaDesigns }),
        }),
```

Şu şekilde güncelle:
```ts
    render: (imageId: string, templateId: string, placement?: { scale: number; offsetX: number; offsetY: number; rotation: number }, areaDesigns?: Record<string, { imageId: string; imageUrl: string }>, productColor?: string) =>
        request<MockupRecord>('/mockups/render', {
            method: 'POST',
            body: JSON.stringify({ imageId, templateId, placement, areaDesigns, productColor }),
        }),
```

Mevcut `renderBatch` fonksiyonu (satır ~365):
```ts
    renderBatch: (imageId: string, templateIds: string[], placement?: { scale: number; offsetX: number; offsetY: number; rotation: number }) =>
        request<{ message: string; results: { templateId: string; templateName: string; status: string; url?: string; error?: string }[] }>('/mockups/render-batch', {
            method: 'POST',
            body: JSON.stringify({ imageId, templateIds, placement }),
        }),
```

Şu şekilde güncelle:
```ts
    renderBatch: (imageId: string, templateIds: string[], placement?: { scale: number; offsetX: number; offsetY: number; rotation: number }, productColor?: string) =>
        request<{ message: string; results: { templateId: string; templateName: string; status: string; url?: string; error?: string }[] }>('/mockups/render-batch', {
            method: 'POST',
            body: JSON.stringify({ imageId, templateIds, placement, productColor }),
        }),
```

- [ ] **Step 2: `generateShadow` ve `bulkUpload` fonksiyonları ekle**

`renderBatch` fonksiyonundan hemen sonra ekle:

```ts
    generateShadow: (templateId: string) =>
        request<{ success: boolean; shadowImagePath: string; template: MockupTemplate }>(`/mockups/templates/${templateId}/generate-shadow`, {
            method: 'POST',
        }),

    bulkUpload: async (files: File[], category: string, onProgress?: (done: number, total: number) => void) => {
        const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
        const BATCH_SIZE = 20;
        const allResults: any[] = [];

        for (let i = 0; i < files.length; i += BATCH_SIZE) {
            const batch = files.slice(i, i + BATCH_SIZE);
            const fd = new FormData();
            batch.forEach(f => fd.append('images', f));
            fd.append('category', category);

            const res = await fetch(`${API_BASE}/api/mockups/templates/bulk-upload`, {
                method: 'POST',
                credentials: 'include',
                body: fd,
            });
            const data = await res.json();
            allResults.push(...(data.results || []));
            onProgress?.(Math.min(i + BATCH_SIZE, files.length), files.length);
        }

        return { results: allResults, total: files.length, success: allResults.filter(r => r.status === 'success').length };
    },
```

- [ ] **Step 3: `MockupConfig` tip tanımına `meta` alanları ekle**

`MockupMeta` interface'ini bul (yaklaşık satır ~305-315 civarı) ve güncelle:

```ts
interface MockupMeta {
    view?: string;
    background?: string;
    color?: string;
    hasHumanModel?: boolean;
    isPsdDerived?: boolean;
    grayBasePath?: string;
    defaultColor?: string;
    shadowSource?: 'psd' | 'preset' | 'ai';
    layerMap?: { smartObject?: string | null; shadow?: string | null };
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat: api.ts — productColor in render/renderBatch, generateShadow, bulkUpload with batching"
```

---

## Task 6: `MockupsClient.tsx` — `BulkUploadModal` Yükseltme

**Files:**
- Modify: `frontend/app/dashboard/mockups/MockupsClient.tsx` (satır 1953-2101)

- [ ] **Step 1: Import satırlarına `PackageOpen` ekle**

Mevcut import satırı (satır ~10):
```tsx
import { ..., Upload } from 'lucide-react';
```

`PackageOpen` ve `FileCode2` ekle:
```tsx
import { ..., Upload, PackageOpen, FileCode2 } from 'lucide-react';
```

- [ ] **Step 2: Mevcut `BulkUploadModal` bileşenini tamamen değiştir**

Satır 1953'ten başlayan `function BulkUploadModal` bileşenini (2101'e kadar) silin ve şu yeni versiyonla değiştirin:

```tsx
type BulkFileEntry = {
    file: File;
    status: 'pending' | 'uploading' | 'success' | 'error';
    error?: string;
    type: 'psd' | 'png' | 'jpg' | 'other';
};

function getFileType(file: File): BulkFileEntry['type'] {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (ext === 'psd') return 'psd';
    if (ext === 'png') return 'png';
    if (['jpg', 'jpeg', 'webp'].includes(ext)) return 'jpg';
    return 'other';
}

function FileBadge({ type }: { type: BulkFileEntry['type'] }) {
    const styles: Record<string, string> = {
        psd:   'bg-purple-600/20 text-purple-400 border-purple-500/30',
        png:   'bg-green-600/20 text-green-400 border-green-500/30',
        jpg:   'bg-blue-600/20 text-blue-400 border-blue-500/30',
        other: 'bg-slate-600/20 text-slate-400 border-slate-500/30',
    };
    return (
        <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded border uppercase tracking-wide ${styles[type] || styles.other}`}>
            {type.toUpperCase()}
        </span>
    );
}

function BulkUploadModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
    const [entries, setEntries] = useState<BulkFileEntry[]>([]);
    const [category, setCategory] = useState('tshirt');
    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
    const BATCH_SIZE = 20;

    const addFiles = (fileList: FileList | null) => {
        if (!fileList) return;
        const allowed = ['jpg', 'jpeg', 'png', 'webp', 'psd'];
        const newEntries = Array.from(fileList)
            .filter(f => allowed.includes(f.name.split('.').pop()?.toLowerCase() || ''))
            .map(f => ({ file: f, status: 'pending' as const, type: getFileType(f) }));
        setEntries(prev => [...prev, ...newEntries]);
    };

    const removeEntry = (idx: number) =>
        setEntries(prev => prev.filter((_, i) => i !== idx));

    const startUpload = async () => {
        if (entries.length === 0 || isRunning) return;
        setIsRunning(true);

        const files = entries.map(e => e.file);
        let done = 0;
        setProgress({ done: 0, total: files.length });

        // Mark all pending
        setEntries(prev => prev.map(e => ({ ...e, status: 'pending' })));

        for (let i = 0; i < files.length; i += BATCH_SIZE) {
            const batchFiles = files.slice(i, i + BATCH_SIZE);
            const batchIndices = batchFiles.map((_, j) => i + j);

            // Mark batch as uploading
            setEntries(prev => prev.map((e, idx) =>
                batchIndices.includes(idx) ? { ...e, status: 'uploading' } : e
            ));

            try {
                const fd = new FormData();
                batchFiles.forEach(f => fd.append('images', f));
                fd.append('category', category);

                const res = await fetch(`${API_BASE}/api/mockups/templates/bulk-upload`, {
                    method: 'POST',
                    credentials: 'include',
                    body: fd,
                });
                const data = await res.json();
                const batchResults: any[] = data.results || [];

                setEntries(prev => {
                    const next = [...prev];
                    batchIndices.forEach((origIdx, batchIdx) => {
                        const r = batchResults[batchIdx];
                        if (!r) { next[origIdx] = { ...next[origIdx], status: 'error', error: 'No result' }; return; }
                        next[origIdx] = {
                            ...next[origIdx],
                            status: r.status === 'success' ? 'success' : 'error',
                            error: r.error,
                        };
                    });
                    return next;
                });
            } catch (err: any) {
                setEntries(prev => prev.map((e, idx) =>
                    batchIndices.includes(idx) ? { ...e, status: 'error', error: err.message } : e
                ));
            }

            done += batchFiles.length;
            setProgress({ done, total: files.length });
        }

        setIsRunning(false);
        onSuccess();
    };

    const successCount = entries.filter(e => e.status === 'success').length;
    const errorCount = entries.filter(e => e.status === 'error').length;
    const isDone = !isRunning && entries.length > 0 && entries.every(e => e.status === 'success' || e.status === 'error');

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-[#1a2332] border border-slate-700 rounded-2xl w-full max-w-2xl p-6 space-y-5 shadow-2xl max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between shrink-0">
                    <div>
                        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                            <PackageOpen className="w-5 h-5 text-purple-400" /> Toplu Mockup Aktarımı
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">PNG, JPG ve PSD desteklenir — PSD'ler otomatik analiz edilir</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>

                {/* Category */}
                {!isRunning && !isDone && (
                    <div className="shrink-0">
                        <label className="text-xs text-slate-400 mb-1.5 block">Kategori (tüm dosyalar için)</label>
                        <select
                            value={category}
                            onChange={e => setCategory(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                        >
                            {CATEGORIES.filter(c => c !== 'all').map(c => (
                                <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>
                            ))}
                        </select>
                    </div>
                )}

                {/* Drop zone */}
                {!isRunning && !isDone && (
                    <div
                        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={e => { e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files); }}
                        onClick={() => fileInputRef.current?.click()}
                        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all shrink-0 ${
                            isDragging ? 'border-purple-500 bg-purple-500/10' : 'border-slate-600 hover:border-slate-400'
                        }`}
                    >
                        <input ref={fileInputRef} type="file" multiple accept="image/*,.psd" className="hidden"
                            onChange={e => addFiles(e.target.files)} />
                        <Upload className="w-7 h-7 text-slate-500 mx-auto mb-2" />
                        <p className="text-sm text-slate-300">Dosyaları buraya sürükleyin veya seçin</p>
                        <p className="text-xs text-slate-500 mt-1">
                            <span className="text-purple-400">PSD</span> · <span className="text-green-400">PNG</span> · <span className="text-blue-400">JPG</span> — sınırsız dosya
                        </p>
                    </div>
                )}

                {/* Progress bar */}
                {isRunning && (
                    <div className="shrink-0 space-y-1.5">
                        <div className="flex justify-between text-xs text-slate-400">
                            <span>İşleniyor...</span>
                            <span>{progress.done}/{progress.total}</span>
                        </div>
                        <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-purple-600 to-blue-600 transition-all duration-300"
                                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* Done summary */}
                {isDone && (
                    <div className="shrink-0 flex gap-3">
                        <div className="flex-1 bg-emerald-600/10 border border-emerald-500/30 rounded-xl p-3 text-center">
                            <p className="text-2xl font-bold text-emerald-400">{successCount}</p>
                            <p className="text-xs text-emerald-300 mt-0.5">Başarılı</p>
                        </div>
                        {errorCount > 0 && (
                            <div className="flex-1 bg-red-600/10 border border-red-500/30 rounded-xl p-3 text-center">
                                <p className="text-2xl font-bold text-red-400">{errorCount}</p>
                                <p className="text-xs text-red-300 mt-0.5">Hatalı</p>
                            </div>
                        )}
                    </div>
                )}

                {/* File list */}
                {entries.length > 0 && (
                    <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
                        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                            <span>{entries.length} dosya</span>
                            {!isRunning && !isDone && (
                                <button onClick={() => setEntries([])} className="hover:text-red-400 transition-colors">Temizle</button>
                            )}
                        </div>
                        {entries.map((entry, idx) => (
                            <div key={idx} className={cn(
                                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors',
                                entry.status === 'success' && 'bg-emerald-500/10',
                                entry.status === 'error' && 'bg-red-500/10',
                                entry.status === 'uploading' && 'bg-blue-500/10',
                                entry.status === 'pending' && 'bg-slate-800/60',
                            )}>
                                <FileBadge type={entry.type} />
                                <span className="flex-1 text-slate-300 truncate">{entry.file.name}</span>
                                <span className="text-slate-500 shrink-0">{(entry.file.size / 1024 / 1024).toFixed(1)}MB</span>
                                {entry.status === 'pending' && <span className="text-slate-500 shrink-0">bekliyor</span>}
                                {entry.status === 'uploading' && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400 shrink-0" />}
                                {entry.status === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                                {entry.status === 'error' && (
                                    <span className="text-red-400 shrink-0 max-w-[140px] truncate" title={entry.error}>{entry.error}</span>
                                )}
                                {!isRunning && !isDone && (
                                    <button onClick={() => removeEntry(idx)} className="text-slate-600 hover:text-red-400 transition-colors shrink-0">
                                        <X className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 shrink-0 pt-1">
                    <button onClick={onClose} className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-xl transition-colors">
                        {isDone ? 'Kapat' : 'İptal'}
                    </button>
                    {!isDone && (
                        <button
                            onClick={startUpload}
                            disabled={isRunning || entries.length === 0}
                            className="flex-1 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
                        >
                            {isRunning
                                ? <><Loader2 className="w-4 h-4 animate-spin" /> Yükleniyor ({progress.done}/{progress.total})</>
                                : <><Upload className="w-4 h-4" /> {entries.length} Dosya Yükle</>
                            }
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/app/dashboard/mockups/MockupsClient.tsx
git commit -m "feat: upgrade BulkUploadModal — PSD support, 100+ files, batching, per-file status, progress bar"
```

---

## Task 7: Renk Picker — PSD Template'lerde Tişört Rengi

**Files:**
- Modify: `frontend/app/dashboard/mockups/MockupsClient.tsx`

- [ ] **Step 1: Renk state'ini ana bileşene ekle**

`MockupsClient` fonksiyonunun state bölümüne (satır ~148 civarı) şunu ekle:

```tsx
// productColor: per-template, localStorage'da hatırlanır
const [productColors, setProductColors] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('mockup_product_colors') || '{}'); } catch { return {}; }
});

const setProductColor = (templateId: string, color: string) => {
    const next = { ...productColors, [templateId]: color };
    setProductColors(next);
    localStorage.setItem('mockup_product_colors', JSON.stringify(next));
};
```

- [ ] **Step 2: Renk swatchleri için sabit ekle**

`CATEGORY_LABELS` sabitinden sonra ekle:

```tsx
const SHIRT_COLORS = [
    { label: 'Beyaz',    hex: '#FFFFFF' },
    { label: 'Siyah',    hex: '#1a1a1a' },
    { label: 'Lacivert', hex: '#1B3A6B' },
    { label: 'Gri',      hex: '#9CA3AF' },
    { label: 'Kırmızı',  hex: '#DC2626' },
    { label: 'Yeşil',    hex: '#15803D' },
    { label: 'Bej',      hex: '#D4B896' },
    { label: 'Sarı',     hex: '#FBBF24' },
];
```

- [ ] **Step 3: `ColorPicker` bileşeni ekle (dosyanın sonuna, `BulkUploadModal`'dan önce)**

```tsx
function ColorPicker({ templateId, value, onChange }: { templateId: string; value: string; onChange: (c: string) => void }) {
    const [custom, setCustom] = useState(value);
    return (
        <div className="space-y-2">
            <p className="text-xs text-slate-400">Ürün Rengi</p>
            <div className="flex flex-wrap gap-1.5">
                {SHIRT_COLORS.map(c => (
                    <button
                        key={c.hex}
                        title={c.label}
                        onClick={() => { setCustom(c.hex); onChange(c.hex); }}
                        className={cn(
                            'w-6 h-6 rounded-full border-2 transition-transform hover:scale-110',
                            value === c.hex ? 'border-accent scale-110' : 'border-slate-600',
                        )}
                        style={{ backgroundColor: c.hex }}
                    />
                ))}
            </div>
            <div className="flex items-center gap-2">
                <input
                    type="color"
                    value={custom}
                    onChange={e => { setCustom(e.target.value); onChange(e.target.value); }}
                    className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
                />
                <input
                    type="text"
                    value={custom}
                    onChange={e => { setCustom(e.target.value); if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) onChange(e.target.value); }}
                    placeholder="#FFFFFF"
                    className="flex-1 px-2 py-1 bg-slate-800 border border-slate-600 rounded text-xs text-white font-mono focus:outline-none focus:border-accent"
                />
            </div>
        </div>
    );
}
```

- [ ] **Step 4: `DesignPlacementEditor` render çağrısına `productColor` ver**

`MockupsClient.tsx` içinde `DesignPlacementEditor`'ın render edildiği yeri bulun (yaklaşık satır ~484-500 civarı, `showEditor` state ile kontrol ediliyor). `selectedTemplate` ve `productColor` olan bölümde şu şekilde:

Dosyada `<DesignPlacementEditor` çağrısını bulun ve `productColor` prop'unu ekleyin:
```tsx
productColor={selectedTemplate ? productColors[selectedTemplate.id] : undefined}
```

**Not:** `DesignPlacementEditor` henüz bu prop'u kabul etmiyor. Bileşen kendi render çağrısını yönetiyorsa, render isteğine productColor'ı inject etmek için Task 7 Step 5'e bakın.

- [ ] **Step 5: Template kartlarına renk picker ekle**

Template card render edilen yerde (şablonun üzerine tıklandığında / selected state), `configJson.meta.isPsdDerived` true ise renk picker göster.

Template kartı seçildiğinde görünen detay paneline (veya `selectedTemplate` state varken render edilen bölüme) şu bloğu ekle:

```tsx
{selectedTemplate?.configJson?.meta?.isPsdDerived && (
    <div className="mt-3 p-3 bg-slate-800/60 rounded-xl border border-slate-700">
        <ColorPicker
            templateId={selectedTemplate.id}
            value={productColors[selectedTemplate.id] || selectedTemplate.configJson?.meta?.defaultColor || '#FFFFFF'}
            onChange={(color) => setProductColor(selectedTemplate.id, color)}
        />
    </div>
)}
```

- [ ] **Step 6: `apiMockups.render` ve `renderBatch` çağrılarına `productColor` geç**

Dosyada `apiMockups.render(` araması yapın. Her çağrıya son parametre olarak `productColors[templateId]` ekleyin.

`apiMockups.renderBatch(` çağrısı (satır ~200):
```tsx
const result = await apiMockups.renderBatch(
    bulkDesignImageId,
    Array.from(bulkSelectedIds),
    undefined,
    productColors[Array.from(bulkSelectedIds)[0]] // bulk render için ilk seçili template rengi
);
```

- [ ] **Step 7: Commit**

```bash
git add frontend/app/dashboard/mockups/MockupsClient.tsx
git commit -m "feat: product color picker for PSD templates — tint swatches + hex input + localStorage persistence"
```

---

## Task 8: "AI Shadow Üret" Butonu

**Files:**
- Modify: `frontend/app/dashboard/mockups/MockupsClient.tsx`

- [ ] **Step 1: `Wand2` ikonunu import'a ekle**

```tsx
import { ..., Wand2 } from 'lucide-react';
```

- [ ] **Step 2: Shadow generation state ekle**

`MockupsClient` state bölümüne:

```tsx
const [shadowGenerating, setShadowGenerating] = useState<string | null>(null); // templateId
```

- [ ] **Step 3: Handler fonksiyonu ekle**

`handleDelete` fonksiyonundan sonra ekle:

```tsx
const handleGenerateShadow = async (template: MockupTemplate) => {
    if (!confirm(`"${template.name}" için AI shadow üretilecek (~10 sn). Devam edilsin mi?`)) return;
    setShadowGenerating(template.id);
    try {
        await apiMockups.generateShadow(template.id);
        addToast('success', 'AI shadow oluşturuldu!');
        loadTemplates();
    } catch (err: any) {
        addToast('error', 'Shadow üretilemedi: ' + err.message);
    } finally {
        setShadowGenerating(null);
    }
};
```

- [ ] **Step 4: AI Shadow butonunu template kartına ekle**

Template kartının render edildiği yerde (delete butonu gibi action butonların yanına), `isPsdDerived` ve shadow kaynağı `preset` olan templatelar için:

```tsx
{template.configJson?.meta?.isPsdDerived &&
 template.configJson?.meta?.shadowSource !== 'ai' && (
    <button
        onClick={(e) => { e.stopPropagation(); handleGenerateShadow(template); }}
        disabled={shadowGenerating === template.id}
        title="AI ile gerçekçi shadow üret"
        className="p-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 transition-colors disabled:opacity-40"
    >
        {shadowGenerating === template.id
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Wand2 className="w-3.5 h-3.5" />
        }
    </button>
)}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/app/dashboard/mockups/MockupsClient.tsx
git commit -m "feat: AI shadow generation button for PSD templates — FAL.ai depth → shadow_ai.png"
```

---

## Self-Review — Spec Kapsamı Kontrolü

| Spec Gereksinimi | Task |
|------------------|------|
| PSD toplu yükleme | Task 3 (backend), Task 6 (frontend modal) |
| Smart object bounds → print area | Task 2 (`psd-analyzer`), Task 3 (`bulk-upload` PSD dalı) |
| Shadow katmanı PSD'den çıkarma | Task 2 (`renderLayerToPng`), Task 3 (shadow kaydı) |
| Preset shadow fallback | Task 1 (PNG üretimi), Task 3 (shadowImagePath atama) |
| AI shadow butonu | Task 5 (`generateShadow` API), Task 3 (route), Task 8 (UI) |
| Tişört rengi değiştirme (tint) | Task 4 (render service), Task 7 (color picker UI) |
| gray_base.png üretimi | Task 2 (analyzer), Task 3 (bulk-upload PSD dalı) |
| `configJson.meta.isPsdDerived` flag | Task 3 |
| `localStorage` renk hatırlama | Task 7 Step 1 |
| 100 dosya limiti + batching | Task 3 (backend), Task 6 (frontend) |
| Per-file status (pending/uploading/success/error) | Task 6 |
