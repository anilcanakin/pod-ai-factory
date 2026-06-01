# Photo Personalization Composite Engine — Design Spec

**Date:** 2026-06-01  
**Status:** Approved — ready for implementation  
**Scope:** Backend + engine only. Approval-queue UI built separately.

---

## 1. Problem & Strategic Basis

~97% of personalized-apparel demand on Etsy is customer-photo based. One template concept —
"customer photo + Comfort Colors shirt" — reuses across occasions (birthday, pet, dad, mom,
couple, graduation) with only text/frame changes. The engine must be **occasion-agnostic and
data-driven**: adding a new occasion requires a new `PhotoTemplate` row, not a code change.

---

## 2. Scope

### In

- `compositePhoto()` engine + BullMQ job
- Prisma models + migrations (`PhotoTemplate`, `PersonalizationOrder`)
- Approval-queue API endpoints + Template CRUD
- One seeded birthday template — proves the full path end to end

### Out (explicit — do not build now)

- Approval-queue frontend UI
- Multi-occasion expansion (pet/dad/mom/couple) — engine supports them via data, only seed birthday
- Per-order automated Etsy photo fetch
- Advanced photo treatments (auto BG removal/upscale beyond what already exists)
- A/B variants, analytics, batch publishing
- Refactor of existing one-click pipeline

---

## 3. Stack Constraints

| Item | Decision |
|---|---|
| Storage | `assets/uploads/personalization/` via existing `uploadToStorage()` — **no Supabase** |
| Image processing | Sharp only — no new heavy raster dependency |
| Text rendering | Sharp + SVG `@font-face` overlays — no canvas library |
| Fonts | Bundled in `assets/fonts/` — base64-embedded in SVG at render time |
| Backend port | 3001 |
| Frontend | Next.js 14 App Router (UI out of scope for this spec) |

---

## 4. Data Model

### 4.1 `PhotoTemplate`

```prisma
model PhotoTemplate {
  id             String   @id @default(uuid())
  workspaceId    String
  workspace      Workspace @relation(fields: [workspaceId], references: [id])
  name           String
  occasion       String   // free string: "birthday" | "pet" | "dad" | …
  baseArtworkUrl String   // relative path: assets/uploads/photo-templates/…
  photoSlot      Json
  // Shape: { x: int, y: int, width: int, height: int,
  //          fit: "cover"|"contain", align: "center"|"top"|"bottom"|"left"|"right",
  //          borderRadius: int,  // 0 = none; equal to width/2 = circle
  //          rotation: float }   // degrees

  textLayers     Json
  // Shape: Array<{
  //   key: string,             // matches variables key: "name" | "year" | "customText"
  //   x: int, y: int,          // top-left origin in print canvas coords
  //   font: string,            // must match a key in FONT_REGISTRY (see §6.3)
  //   size: int,               // px in print canvas coords
  //   color: string,           // CSS hex or rgba
  //   align: "left"|"center"|"right",
  //   maxWidth: int,           // px — text compressed only if it overflows (see §6.4)
  //   transform: "uppercase"|"lowercase"|null
  // }>

  printWidthPx   Int      // print canvas width  (e.g. 4500 for prod Comfort Colors)
  printHeightPx  Int      // print canvas height (e.g. 5400 for prod Comfort Colors)
  mockupConfig   Json
  // Shape: { mockupTemplateId: string, placement?: object }
  // mockupTemplateId references an existing MockupTemplate row

  active         Boolean  @default(true)
  createdAt      DateTime @default(now())

  orders         PersonalizationOrder[]

  @@index([workspaceId, occasion])
}
```

### 4.2 `PersonalizationOrder`

```prisma
enum PersonalizationStatus {
  PENDING
  COMPOSITING
  COMPOSITED
  APPROVED
  REJECTED
  SENT
  FAILED         // terminal: all BullMQ retries exhausted
}

model PersonalizationOrder {
  id               String                @id @default(uuid())
  workspaceId      String
  workspace        Workspace             @relation(fields: [workspaceId], references: [id])
  etsyOrderRef     String?
  templateId       String
  template         PhotoTemplate         @relation(fields: [templateId], references: [id])
  customerPhotoUrl String               // assets/uploads/personalization/customer-photos/…
  variables        Json                 // { name?: string, year?: string|number, customText?: string }
  status           PersonalizationStatus @default(PENDING)
  printFileUrl     String?              // assets/uploads/personalization/print-files/…
  mockupUrl        String?              // assets/uploads/personalization/mockups/…
  warnings         Json?                // string[] — e.g. ["low_resolution"]
  rejectionReason  String?
  createdAt        DateTime             @default(now())
  updatedAt        DateTime             @updatedAt

  @@index([workspaceId, status])
}
```

### 4.3 Workspace additions

Add two relations to the existing `Workspace` model:

```prisma
photoTemplates        PhotoTemplate[]
personalizationOrders PersonalizationOrder[]
```

---

## 5. File / Module Layout

```
src/
├── routes/
│   ├── personalization.routes.js     ← Order CRUD + approve/reject
│   └── photo-template.routes.js      ← Template CRUD
├── services/
│   └── composite-engine.service.js   ← compositePhoto() — all Sharp logic
├── queues/
│   └── personalization.worker.js     ← BullMQ worker
│
assets/
├── fonts/
│   ├── Montserrat-Bold.ttf           ← bundled, used by birthday template
│   └── Montserrat-Regular.ttf
└── uploads/
    └── personalization/
        ├── customer-photos/          ← multer upload target
        ├── print-files/              ← output: print-ready PNG
        └── mockups/                  ← output: garment mockup PNG

scripts/
└── seed-birthday-template.js         ← seeds 1 PhotoTemplate, no Fal.ai needed

prisma/migrations/
└── YYYYMMDD_add_personalization/
```

Changes to existing files:
- `src/queues/index.js` — add `personalizationQueue`
- `src/index.js` — mount two new routers, register personalization worker
- `prisma/schema.prisma` — add two models + Workspace relations

No other existing files are touched.

---

## 6. Composite Engine — `compositePhoto()`

### 6.1 Contract

```js
// src/services/composite-engine.service.js

/**
 * @param {object} opts
 * @param {string}          opts.templateId
 * @param {Buffer|string}   opts.customerPhoto  — Buffer or URL/local path
 * @param {object}          opts.variables      — { name?, year?, customText? }
 * @param {string}          opts.workspaceId
 * @returns {Promise<{ printFileUrl: string, mockupUrl: string, warnings: string[] }>}
 */
async function compositePhoto({ templateId, customerPhoto, variables, workspaceId })
```

### 6.2 Pipeline (step-by-step)

```
1. Load template from DB (photoSlot, textLayers, baseArtworkUrl, printWidthPx/Height, mockupConfig)

2. Normalise customer photo input
   • Buffer  → use directly
   • URL     → downloadToTemp() (reuse existing helper pattern from mockup-render.service.js)

3. EXIF auto-orient + strip
   const oriented = await sharp(input).rotate().toBuffer()
   // .rotate() with no args reads EXIF orientation and applies it;
   // re-encoding to buffer strips all EXIF metadata

4. Resolution check — slot-relative (see §6.5)

5. Fit customer photo into photoSlot
   • Resolve slot pixel dimensions: { x, y, width: slotW, height: slotH } from template.photoSlot
   • fit="cover"   → sharp.resize(slotW, slotH, { fit:'cover', position: mapAlign(align) })
   • fit="contain" → sharp.resize(slotW, slotH, { fit:'contain', background:{r:0,g:0,b:0,alpha:0} })
   • If borderRadius > 0 → apply SVG circle-clip mask (see §6.6)

6. Load base artwork
   • baseArtworkUrl may be relative path or HTTP URL — resolve via same downloadToTemp() pattern
   • sharp(basePath) → base Sharp instance at printWidthPx × printHeightPx

7. Composite fitted photo onto base at (photoSlot.x, photoSlot.y)
   base.composite([{ input: fittedPhotoBuffer, left: photoSlot.x, top: photoSlot.y }])

8. Render text layers in order (see §6.3, §6.4)
   For each layer in template.textLayers:
     a. Resolve value: variables[layer.key] — if undefined/null, SKIP (no warning; optional field)
     b. Apply transform: "uppercase" → .toUpperCase(), "lowercase" → .toLowerCase()
     c. Build SVG overlay with @font-face embed (see §6.3)
     d. base.composite([{ input: Buffer.from(svg), left: 0, top: 0 }])

9. Output print-ready PNG
   const printBuffer = await base.png().toBuffer()
   // Write buffer to a temp file first (uploadToStorage expects a local path)
   const tmpPrintPath = path.join(os.tmpdir(), `${orderId}_print.png`)
   fs.writeFileSync(tmpPrintPath, printBuffer)
   const storagePath  = `personalization/print-files/${orderId}_print.png`
   const printFileUrl = await uploadToStorage(tmpPrintPath, storagePath)
   fs.unlinkSync(tmpPrintPath)  // clean up

10. Generate garment mockup
    If template.mockupConfig.mockupTemplateId is null → skip, mockupUrl = null
    Otherwise call existing renderMockup() from mockup-render.service.js:
      const mockupRelPath = await renderMockup({
        designPath:  <write printBuffer to a second tmp file, pass that path>,
        template:    <MockupTemplate row fetched by mockupTemplateId>,
        imageId:     orderId,
        workspaceId,
        placement:   template.mockupConfig.placement ?? {}
      })
    renderMockup() saves to assets/outputs/mockups/{workspaceId}/{orderId}_{templateId}.png
    and returns that relative path — store it directly as mockupUrl (no copy needed)

11. Return { printFileUrl, mockupUrl, warnings }
```

### 6.3 Font Bundle Strategy

**Problem:** SVG rendered by Sharp is rasterized server-side by librsvg. If a font is not
present on the system, librsvg silently falls back to a system default — producing inconsistent
output across local dev and VPS environments.

**Solution:** Fonts are bundled in `assets/fonts/` and base64-embedded in every SVG at render
time via `@font-face`.

```
assets/fonts/
├── Montserrat-Bold.ttf
└── Montserrat-Regular.ttf
```

**Font registry** (in `composite-engine.service.js`):

```js
const FONT_REGISTRY = {
  'Montserrat-Bold':    path.join(ASSETS_ROOT, 'fonts/Montserrat-Bold.ttf'),
  'Montserrat-Regular': path.join(ASSETS_ROOT, 'fonts/Montserrat-Regular.ttf'),
};
```

`textLayers[].font` must be a key in `FONT_REGISTRY`. If not found, throw at job start
(fail fast — bad template config, not a retryable error).

**SVG template per text layer:**

```js
function buildTextSvg({ canvasW, canvasH, layer, text, fontB64 }) {
  const anchor = layer.align === 'center' ? 'middle'
               : layer.align === 'right'  ? 'end' : 'start';

  const naturalWidth  = estimateTextWidth(text, layer.size);   // see §6.4
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
```

Font files are read once per composite call and cached in a module-level `Map` (keyed by font
path) to avoid repeated disk reads within a single job.

### 6.4 `maxWidth` / `textLength` — Conditional Overflow Compression

`textLength` + `lengthAdjust="spacingAndGlyphs"` compresses text to fit. Applied **only when
the natural text width exceeds `maxWidth`** — never for short text that fits naturally.

Natural width estimation:

```js
// Rough heuristic: 0.55 × fontSize per character (safe for Latin sans-serif)
// Deliberately conservative — occasional false-positives on wide chars are acceptable
// (mild compression). False-negatives on narrow chars never stretch text.
function estimateTextWidth(text, fontSize) {
  return text.length * fontSize * 0.55;
}
```

Behaviour matrix:

| Text | maxWidth | estimatedWidth | Result |
|---|---|---|---|
| "Emma" (4 chars) | 700px | 4×64×0.55 = 141px | No textLength — natural size |
| "Jo" (2 chars) | 700px | 2×64×0.55 = 70px | No textLength — natural size |
| "Bartholomew" (11 chars) | 700px | 11×64×0.55 = 387px | No textLength — still fits |
| "Bartholomew Christopher" (23 chars) | 700px | 23×64×0.55 = 810px | textLength="700" applied |

### 6.5 Low-Resolution Check — Slot-Relative

Check is performed **after** EXIF auto-orient, **before** resize.

```js
const meta = await sharp(orientedBuffer).metadata();
const { width: slotW, height: slotH } = template.photoSlot;

// Warn if either dimension is below the slot size.
// threshold=1.0 means "at least as wide/tall as the slot".
// Slot coords are in print canvas px, so this scales correctly with printWidthPx.
const RESOLUTION_THRESHOLD = 1.0;
if (meta.width < slotW * RESOLUTION_THRESHOLD || meta.height < slotH * RESOLUTION_THRESHOLD) {
  warnings.push('low_resolution');
}
// Do NOT abort — composite continues, human reviewer decides in approval queue.
```

Why slot-relative: if the seed template has `slotW=300` (low-res seed) and prod has `slotW=1800`
(prod template at 4500px print), the threshold scales automatically. A 400px photo passes the
300px slot but correctly fails the 1800px slot.

### 6.6 `borderRadius` — SVG Circle Clip Mask

Implemented via a Sharp composite mask (no new dependency):

```js
// Creates a white-circle-on-black mask of dimensions slotW × slotH
function buildCircleMaskSvg(slotW, slotH, radius) {
  const cx = slotW / 2, cy = slotH / 2;
  return `<svg width="${slotW}" height="${slotH}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${slotW}" height="${slotH}" fill="black"/>
    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="white"/>
  </svg>`;
}

// Apply:
const maskBuffer = Buffer.from(buildCircleMaskSvg(slotW, slotH, borderRadius));
fittedPhoto = await sharp(fittedPhotoBuffer)
  .composite([{ input: maskBuffer, blend: 'dest-in' }])
  .png()
  .toBuffer();
```

`borderRadius = slotW / 2` → perfect circle. Any smaller value → rounded rectangle.

---

## 7. BullMQ Worker

**Queue name:** `personalization-composite`  
**File:** `src/queues/personalization.worker.js`  
**Concurrency:** 1 (Sharp is CPU-bound; matches existing batch worker pattern)

### Retry strategy — BullMQ-only (single mechanism)

```js
// In src/queues/index.js:
const personalizationQueue = new Queue('personalization-composite', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100, age: 86_400 },
    removeOnFail:     { count: 50,  age: 172_800 },
  }
});
```

Worker behaviour:

```
On job received: { orderId, workspaceId }
  1. Fetch order + template from DB
  2. Set order.status → COMPOSITING
  3. Call compositePhoto()
  4. On success:
       order.status    → COMPOSITED
       order.printFileUrl, order.mockupUrl, order.warnings → saved
  5. On error:
       Log error with orderId
       Re-throw — BullMQ handles retry via attempts/backoff
       Do NOT touch order.status (stays COMPOSITING during retries)
  6. After all retries exhausted (BullMQ 'failed' event on worker):
       order.status → FAILED
```

**No manual re-queue. No PENDING revert. One mechanism.**

The `failed` event listener on the worker sets `FAILED` status:

```js
worker.on('failed', async (job, err) => {
  if (job.attemptsMade >= job.opts.attempts) {
    await prisma.personalizationOrder.update({
      where: { id: job.data.orderId },
      data: { status: 'FAILED' }
    });
  }
});
```

---

## 8. API Endpoints

All routes are workspace-scoped via existing `workspace.middleware.js`.

### Orders (`/api/personalization`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/personalization/orders` | Multer upload + create order + enqueue job. Returns `{ order, status: 'pending' }` |
| `GET` | `/api/personalization/orders?status=` | Filtered list. Includes `mockupUrl`, `printFileUrl`, `warnings`. |
| `GET` | `/api/personalization/orders/:id` | Single order detail |
| `POST` | `/api/personalization/orders/:id/approve` | `status → APPROVED` |
| `POST` | `/api/personalization/orders/:id/reject` | `status → REJECTED`, optional `{ reason }` body |

`POST /orders` request: `multipart/form-data`
- `customerPhoto` — image file
- `templateId` — string
- `variables` — JSON string `{ name?, year?, customText? }`
- `etsyOrderRef` — string (optional)

### Templates (`/api/photo-templates`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/photo-templates` | Create template (JSON body) |
| `GET` | `/api/photo-templates` | List active templates for workspace |
| `GET` | `/api/photo-templates/:id` | Single template detail |
| `PATCH` | `/api/photo-templates/:id` | Update fields |

---

## 9. Birthday Seed Template

File: `scripts/seed-birthday-template.js`

**Base artwork:** Generated programmatically with Sharp (no Fal.ai required for seeding).
A gradient PNG: warm golden background with a simple circular frame cutout area.

**Template config (low-res seed, `1200 × 1440` px):**

```json
{
  "name": "Vintage Birthday Photo Shirt",
  "occasion": "birthday",
  "photoSlot": {
    "x": 300, "y": 180,
    "width": 600, "height": 600,
    "fit": "cover",
    "align": "center",
    "borderRadius": 300,
    "rotation": 0
  },
  "textLayers": [
    {
      "key": "name",
      "x": 600, "y": 880,
      "font": "Montserrat-Bold",
      "size": 64,
      "color": "#FFFFFF",
      "align": "center",
      "maxWidth": 700,
      "transform": "uppercase"
    },
    {
      "key": "year",
      "x": 600, "y": 960,
      "font": "Montserrat-Regular",
      "size": 48,
      "color": "#FFD700",
      "align": "center",
      "maxWidth": 500,
      "transform": null
    }
  ],
  "printWidthPx": 1200,
  "printHeightPx": 1440,
  "mockupConfig": { "mockupTemplateId": null }
}
```

`mockupConfig.mockupTemplateId = null` → mockup step is skipped gracefully if no
`MockupTemplate` exists in the test workspace. `mockupUrl` remains `null`; acceptance test
checks `printFileUrl` (required) and `mockupUrl` (optional for MVP seed).

---

## 10. Acceptance Test

```
Given:
  - Seeded birthday PhotoTemplate in DB
  - Test customer photo (any JPEG, may be low-res)
  - variables = { name: "Emma", year: 1996 }

Steps:
  1. POST /api/personalization/orders
     → 201, order.status = "PENDING"

  2. Worker runs compositePhoto():
     → printFileUrl populated at printWidthPx × printHeightPx
     → "Emma" (uppercase) rendered in Montserrat-Bold, white, center
     → "1996" rendered in Montserrat-Regular, gold, center
     → If test photo < slotWidth (600px), warnings includes "low_resolution"

  3. GET /api/personalization/orders?status=composited (after worker finishes)
     → order appears, printFileUrl populated, mockupUrl present (or null if no mockup template)

  4. POST /api/personalization/orders/:id/approve
     → 200, order.status = "APPROVED"
```

---

## 11. Open Questions / Future Decisions

| Topic | Decision deferred to |
|---|---|
| Font expansion beyond Montserrat | Next template addition |
| `Niche` Brain model (keyword pack + template refs) | Next sprint |
| Automated Etsy order photo fetch | Post Etsy API approval |
| Prod print dimensions per garment type | When first real order arrives |
| Photo slot `rotation` (non-zero) | Not implemented in MVP engine — field exists, ignored |
