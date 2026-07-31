# Thumbnail Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-generate a 400px-wide WebP thumbnail alongside every uploaded/rendered
image so Gallery, Personalization, and Mockups card/list views stop downloading
full-resolution (4500×5400, 8-12MB) PNGs just to show a small preview.

**Architecture:** Hook thumbnail generation into `src/services/storage.service.js`'s
three existing upload functions (the single point ~15 backend call sites already
route through) as an internal side effect — signatures/return values unchanged, so
zero risk to existing callers. One explicit exception: `mockup-template.routes.js`
writes MockupTemplate base images directly via `fs.writeFileSync`, bypassing
storage.service.js, so it gets its own explicit hook. Frontend gets a small
`toThumbUrl()` helper and each target `<img>` tries the thumb first, falling back
to the original on 404 (covers old records with zero backfill).

**Tech Stack:** Sharp (already a dependency), no DB migration, no new npm packages.

---

### Task 1: Thumbnail generation in `storage.service.js`

**Files:**
- Modify: `src/services/storage.service.js`

- [ ] **Step 1: Add `generateThumbnail` helper and derive-path convention**

Add this function to `src/services/storage.service.js`, after `ensureDir` (around line 14):

```js
// storagePath örneği: "generated/abc123_1234567890.png"
// Thumb path örneği:  "generated/abc123_1234567890-thumb.webp"
function toThumbStoragePath(storagePath) {
    return storagePath.replace(/\.[^/.]+$/, '-thumb.webp');
}

/**
 * input: Buffer veya yerel dosya yolu (Sharp ikisini de kabul eder).
 * Hata thumbnail'i asla ana upload'ı kırmaz — sadece loglanır.
 */
async function generateThumbnail(input, storagePath) {
    try {
        const sharp = require('sharp');
        const thumbDest = path.join(UPLOADS_ROOT, toThumbStoragePath(storagePath));
        ensureDir(path.dirname(thumbDest));
        await sharp(input)
            .resize(400, null, { withoutEnlargement: true })
            .webp({ quality: 72 })
            .toFile(thumbDest);
    } catch (err) {
        console.warn('[Storage] Thumbnail üretilemedi:', err.message);
    }
}
```

- [ ] **Step 2: Wire into `uploadToStorage`**

Current (lines 27-33):

```js
async function uploadToStorage(localFilePath, storagePath) {
    const dest = path.join(UPLOADS_ROOT, storagePath);
    ensureDir(path.dirname(dest));
    fs.copyFileSync(localFilePath, dest);
    console.log('[Storage] Dosya kopyalandı:', dest);
    return toPublicUrl(storagePath);
}
```

Replace with:

```js
async function uploadToStorage(localFilePath, storagePath) {
    const dest = path.join(UPLOADS_ROOT, storagePath);
    ensureDir(path.dirname(dest));
    fs.copyFileSync(localFilePath, dest);
    console.log('[Storage] Dosya kopyalandı:', dest);
    await generateThumbnail(dest, storagePath);
    return toPublicUrl(storagePath);
}
```

- [ ] **Step 3: Wire into `uploadUrlToStorage`**

Current (lines 39-51):

```js
async function uploadUrlToStorage(imageUrl, storagePath) {
    const fetch = require('node-fetch');
    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error(`[Storage] Görsel indirilemedi (${response.status}): ${imageUrl}`);
    }
    const buffer = await response.buffer();
    const dest = path.join(UPLOADS_ROOT, storagePath);
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, buffer);
    console.log('[Storage] URL kaydedildi:', dest);
    return toPublicUrl(storagePath);
}
```

Replace with:

```js
async function uploadUrlToStorage(imageUrl, storagePath) {
    const fetch = require('node-fetch');
    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error(`[Storage] Görsel indirilemedi (${response.status}): ${imageUrl}`);
    }
    const buffer = await response.buffer();
    const dest = path.join(UPLOADS_ROOT, storagePath);
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, buffer);
    console.log('[Storage] URL kaydedildi:', dest);
    await generateThumbnail(buffer, storagePath);
    return toPublicUrl(storagePath);
}
```

- [ ] **Step 4: Wire into `uploadBufferToStorage`**

Current (lines 83-89):

```js
async function uploadBufferToStorage(buffer, storagePath, contentType = 'image/png') {
    const dest = path.join(UPLOADS_ROOT, storagePath);
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, buffer);
    console.log('[Storage] Buffer kaydedildi:', dest);
    return toPublicUrl(storagePath);
}
```

Replace with:

```js
async function uploadBufferToStorage(buffer, storagePath, contentType = 'image/png') {
    const dest = path.join(UPLOADS_ROOT, storagePath);
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, buffer);
    console.log('[Storage] Buffer kaydedildi:', dest);
    await generateThumbnail(buffer, storagePath);
    return toPublicUrl(storagePath);
}
```

Do **not** touch `uploadRejectedToStorage` — it already produces its own
512×512 JPEG thumbnail, no nested thumbnailing needed.

- [ ] **Step 5: Export `generateThumbnail`**

Current exports (lines 91-96):

```js
module.exports = {
    uploadToStorage,
    uploadUrlToStorage,
    uploadRejectedToStorage,
    uploadBufferToStorage,
};
```

Replace with:

```js
module.exports = {
    uploadToStorage,
    uploadUrlToStorage,
    uploadRejectedToStorage,
    uploadBufferToStorage,
    generateThumbnail,
};
```

(Needed by Task 2, which calls `generateThumbnail` directly from
`mockup-template.routes.js` since that route bypasses the upload functions.)

- [ ] **Step 6: Verify with a manual script**

Create `scripts/test-thumbnail-generation.js` (repo convention: ad-hoc
`scripts/test-*.js`, no Jest/test framework in this project):

```js
// Manuel doğrulama: uploadToStorage/uploadBufferToStorage çağrıldığında
// yanında bir -thumb.webp dosyası da oluşuyor mu?
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const sharp = require('sharp');
const { uploadBufferToStorage } = require('../src/services/storage.service');

async function main() {
    // 1x1 kırmızı piksel PNG (Sharp ile üretildi — harici dosyaya bağımlı değil)
    const pngBuffer = await sharp({
        create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 0, b: 0 } }
    }).png().toBuffer();

    const storagePath = `test/thumb-check-${Date.now()}.png`;
    const publicUrl = await uploadBufferToStorage(pngBuffer, storagePath);
    console.log('Original URL:', publicUrl);

    const thumbPath = path.join(__dirname, '../assets/uploads', storagePath.replace(/\.png$/, '-thumb.webp'));
    assert(fs.existsSync(thumbPath), `Thumbnail oluşmadı: ${thumbPath}`);
    const stats = fs.statSync(thumbPath);
    assert(stats.size > 0, 'Thumbnail dosyası boş');
    console.log('✓ Thumbnail oluştu:', thumbPath, `(${stats.size} bytes)`);

    // Cleanup
    fs.unlinkSync(path.join(__dirname, '../assets/uploads', storagePath));
    fs.unlinkSync(thumbPath);
}

main().catch(err => { console.error('✗ FAILED:', err.message); process.exit(1); });
```

Run: `node scripts/test-thumbnail-generation.js`
Expected: `✓ Thumbnail oluştu: ...` printed, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add src/services/storage.service.js scripts/test-thumbnail-generation.js
git commit -m "feat: auto-generate thumbnails in storage.service.js upload functions"
```

---

### Task 2: Thumbnail for MockupTemplate base images (upload-time)

**Files:**
- Modify: `src/routes/mockup-template.routes.js`

The three existing storage.service.js functions are NOT used here — base images
are written directly via `fs.writeFileSync`/multer, so this needs its own explicit
call using the same helper.

**Depends on Task 1** (needs `generateThumbnail` exported from `storage.service.js`,
added there in Task 1 Step 5).

- [ ] **Step 1: Import the thumbnail helper**

Near the top of `src/routes/mockup-template.routes.js`, alongside other requires:

```js
const { generateThumbnail } = require('../services/storage.service');
```

- [ ] **Step 2: PSD branch — thumbnail the flattened base PNG**

Current (around line 150-151 in `mockup-template.routes.js`):

```js
                // Save base PNG (flattened render)
                const basePngName = 'base.png';
                fs.writeFileSync(path.join(finalDir, basePngName), psdResult.baseBuffer);
```

Add immediately after:

```js
                await generateThumbnail(
                    psdResult.baseBuffer,
                    `mockups/${category}/${templateId}/${basePngName}`
                );
```

- [ ] **Step 3: Standard branch — thumbnail the uploaded base image**

Current (around line 194 in `mockup-template.routes.js`):

```js
                // ── Standard image path ──
                baseImagePath   = `assets/mockups/${category}/${templateId}/${baseFile.filename}`;
                maskImagePath   = maskFile ? `assets/mockups/${category}/${templateId}/${maskFile.filename}` : null;
                shadowImagePath = shadowFile ? `assets/mockups/${category}/${templateId}/${shadowFile.filename}` : null;
```

Add immediately after (base file is already on disk at `finalDir` at this point):

```js
                await generateThumbnail(
                    path.join(finalDir, baseFile.filename),
                    `mockups/${category}/${templateId}/${baseFile.filename}`
                );
```

Note: `generateThumbnail`'s second argument is a **storage-relative path** (matching
the `mockups/...` prefix `toPublicUrl`/`toThumbStoragePath` expect), not the
`assets/mockups/...` public-URL form used by `baseImagePath` — this mirrors exactly
how `storagePath` is used everywhere else in `storage.service.js`.

- [ ] **Step 4: Manual verification**

Per the project's own asset-testing rule, template upload must be tested against
the real server (`http://100.96.119.102:3000`), not localhost (localhost is
missing almost all `MockupTemplate` base image files). Upload one standard image
template and one PSD template there; confirm
`assets/mockups/{category}/{templateId}/base-thumb.webp` (or
`{filename}-thumb.webp` for standard) appears next to the original.

- [ ] **Step 5: Commit**

```bash
git add src/routes/mockup-template.routes.js src/services/storage.service.js
git commit -m "feat: generate thumbnail for MockupTemplate base image on upload"
```

---

### Task 3: Frontend `toThumbUrl` helper

**Files:**
- Modify: `frontend/lib/utils.ts`

- [ ] **Step 1: Add the helper**

Add to `frontend/lib/utils.ts` (after `truncateId`, end of file):

```typescript
// Backend'in storage.service.js'teki thumbnail konvansiyonuyla birebir eşleşir:
// aynı dizin, uzantı "-thumb.webp" ile değişir.
export function toThumbUrl(url: string): string {
    if (!url) return url;
    return url.replace(/\.[^/.]+$/, "-thumb.webp");
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/utils.ts
git commit -m "feat: add toThumbUrl frontend helper"
```

---

### Task 4: Wire thumbnails into GalleryClient.tsx

**Files:**
- Modify: `frontend/app/dashboard/gallery/GalleryClient.tsx`

- [ ] **Step 1: Import `toThumbUrl`**

Current (line 7):

```tsx
import { cn, truncateId } from '@/lib/utils';
```

Replace with:

```tsx
import { cn, truncateId, toThumbUrl } from '@/lib/utils';
```

- [ ] **Step 2: Main card grid — rejected variant (line 810)**

Current:

```tsx
                        <img src={resolveUrl(img.imageUrl)} alt="Rejected design" className="w-full aspect-square object-cover block opacity-40 grayscale" onClick={onView} />
```

Replace with:

```tsx
                        <img
                            src={toThumbUrl(resolveUrl(img.imageUrl))}
                            alt="Rejected design"
                            className="w-full aspect-square object-cover block opacity-40 grayscale"
                            onClick={onView}
                            onError={e => {
                                const original = resolveUrl(img.imageUrl);
                                if (e.currentTarget.src !== original) e.currentTarget.src = original;
                            }}
                        />
```

- [ ] **Step 3: Main card grid — normal variant (line 825)**

Current:

```tsx
                <img src={resolveUrl(img.imageUrl)} alt="Generated design" className="w-full aspect-square object-cover block" onClick={onView} />
```

Replace with:

```tsx
                <img
                    src={toThumbUrl(resolveUrl(img.imageUrl))}
                    alt="Generated design"
                    className="w-full aspect-square object-cover block"
                    onClick={onView}
                    onError={e => {
                        const original = resolveUrl(img.imageUrl);
                        if (e.currentTarget.src !== original) e.currentTarget.src = original;
                    }}
                />
```

- [ ] **Step 4: Mockup sub-list inside detail view (line 655)**

Current:

```tsx
                                            <img key={m.id} src={resolveUrl(m.mockupUrl)} alt="Mockup" className="w-full aspect-square object-cover rounded-lg border border-border-default" />
```

Replace with:

```tsx
                                            <img
                                                key={m.id}
                                                src={toThumbUrl(resolveUrl(m.mockupUrl))}
                                                alt="Mockup"
                                                className="w-full aspect-square object-cover rounded-lg border border-border-default"
                                                onError={e => {
                                                    const original = resolveUrl(m.mockupUrl);
                                                    if (e.currentTarget.src !== original) e.currentTarget.src = original;
                                                }}
                                            />
```

Do **not** touch line 650 (the large `viewImg.imageUrl` full view in the same
detail panel) — that stays full resolution, matching the lightbox rule.

- [ ] **Step 5: ListingCard (line 906)**

Current (lines 904-910):

```tsx
                <img
                    src={resolveUrl(displayUrl)}
                    alt="Listing"
                    className="w-full h-full object-cover"
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
```

Replace with:

```tsx
                <img
                    src={toThumbUrl(resolveUrl(displayUrl))}
                    alt="Listing"
                    className="w-full h-full object-cover"
                    onError={e => {
                        const original = resolveUrl(displayUrl);
                        const img = e.currentTarget as HTMLImageElement;
                        if (img.src !== original) { img.src = original; }
                        else { img.style.display = 'none'; }
                    }}
                />
```

- [ ] **Step 6: Commit**

```bash
git add frontend/app/dashboard/gallery/GalleryClient.tsx
git commit -m "feat: use thumbnails in Gallery card grid and mockup sub-list"
```

---

### Task 5: Wire thumbnail into PersonalizationClient.tsx

**Files:**
- Modify: `frontend/app/dashboard/personalization/PersonalizationClient.tsx`

- [ ] **Step 1: Import `toThumbUrl`**

Current (line 6):

```tsx
import { cn } from '@/lib/utils';
```

Replace with:

```tsx
import { cn, toThumbUrl } from '@/lib/utils';
```

- [ ] **Step 2: SİPARİŞLER thumbnail (lines 314-320)**

Current:

```tsx
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img
                                                    src={resolveUrl(thumbUrl)}
                                                    alt=""
                                                    className="w-full h-full object-cover"
                                                    onError={() => setBrokenThumbIds(prev => new Set(prev).add(o.id))}
                                                />
```

Replace with:

```tsx
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img
                                                    src={toThumbUrl(resolveUrl(thumbUrl))}
                                                    alt=""
                                                    className="w-full h-full object-cover"
                                                    onError={e => {
                                                        const original = resolveUrl(thumbUrl);
                                                        if (e.currentTarget.src !== original) {
                                                            e.currentTarget.src = original;
                                                        } else {
                                                            setBrokenThumbIds(prev => new Set(prev).add(o.id));
                                                        }
                                                    }}
                                                />
```

This preserves the existing `brokenThumbIds` behavior (placeholder shown only
when BOTH the thumbnail and the original fail) — old orders without a thumbnail
now transparently fall back to their original `printFileUrl`/`customerPhotoUrl`
instead of being marked broken.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/dashboard/personalization/PersonalizationClient.tsx
git commit -m "feat: use thumbnail with original fallback in Personalization orders table"
```

---

### Task 6: Wire thumbnails into MockupsClient.tsx

**Files:**
- Modify: `frontend/app/dashboard/mockups/MockupsClient.tsx`

- [ ] **Step 1: Import `toThumbUrl`**

Current (line 12):

```tsx
import { cn } from '@/lib/utils';
```

Replace with:

```tsx
import { cn, toThumbUrl } from '@/lib/utils';
```

- [ ] **Step 2: Template picker card (lines 646-651)**

Current:

```tsx
                <img
                    src={resolveUrl(template.baseImagePath)}
                    alt={template.name}
                    className="w-full h-full object-contain p-2"
                    onError={e => { e.currentTarget.style.display = 'none'; }}
                />
```

Replace with:

```tsx
                <img
                    src={toThumbUrl(resolveUrl(template.baseImagePath))}
                    alt={template.name}
                    className="w-full h-full object-contain p-2"
                    onError={e => {
                        const original = resolveUrl(template.baseImagePath);
                        if (e.currentTarget.src !== original) { e.currentTarget.src = original; }
                        else { e.currentTarget.style.display = 'none'; }
                    }}
                />
```

- [ ] **Step 3: Bulk render results grid (lines 474-484)**

Current:

```tsx
                                            {(() => {
                                                const resolvedUrl = resolveUrl(r.url);
                                                return (
                                                    <img
                                                        src={resolvedUrl}
                                                        alt={r.templateName}
                                                        className="w-full aspect-square object-contain"
                                                        onError={(e) => { console.error('Bulk render img failed:', r.url); }}
                                                    />
                                                );
                                            })()}
```

Replace with:

```tsx
                                            {(() => {
                                                const resolvedUrl = resolveUrl(r.url);
                                                return (
                                                    <img
                                                        src={toThumbUrl(resolvedUrl)}
                                                        alt={r.templateName}
                                                        className="w-full aspect-square object-contain"
                                                        onError={(e) => {
                                                            if (e.currentTarget.src !== resolvedUrl) {
                                                                e.currentTarget.src = resolvedUrl;
                                                            } else {
                                                                console.error('Bulk render img failed:', r.url);
                                                            }
                                                        }}
                                                    />
                                                );
                                            })()}
```

- [ ] **Step 4: Bulk-export mockup picker grid (lines 2590-2595)**

Current:

```tsx
                                                <img
                                                    src={url}
                                                    alt="Mockup"
                                                    className="w-full h-full object-cover"
                                                    onError={e => { e.currentTarget.style.display = 'none'; }}
                                                />
```

Replace with:

```tsx
                                                <img
                                                    src={toThumbUrl(url)}
                                                    alt="Mockup"
                                                    className="w-full h-full object-cover"
                                                    onError={e => {
                                                        if (e.currentTarget.src !== url) { e.currentTarget.src = url; }
                                                        else { e.currentTarget.style.display = 'none'; }
                                                    }}
                                                />
```

- [ ] **Step 5: Commit**

```bash
git add frontend/app/dashboard/mockups/MockupsClient.tsx
git commit -m "feat: use thumbnails in Mockups template picker and render result grids"
```

---

### Task 7: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Backend thumbnail generation**

Run `node scripts/test-thumbnail-generation.js` (from Task 1) — confirm it
still passes after all other changes.

- [ ] **Step 2: Real-server verification**

Per the project's asset-testing rule, do this against `http://100.96.119.102:3000`,
not localhost:

1. Generate one new design (Factory page) → confirm `assets/uploads/generated/*-thumb.webp`
   appears next to the original.
2. Render one mockup (Mockups page, single or bulk) → confirm the mockup's
   `-thumb.webp` appears.
3. Submit one personalization order with a photo → confirm the print file's
   `-thumb.webp` appears.
4. Open Gallery, Personalization, and Mockups pages → open browser DevTools
   Network tab → confirm the card/list thumbnails load the small `.webp` files
   (KB range), not the multi-MB originals.
5. Find one pre-existing (old) record with no thumbnail on disk → confirm its
   card still renders the original image with no console errors (onError
   fallback works).
6. Open a lightbox / full-view / print-export for any image → confirm it still
   shows full original resolution.

- [ ] **Step 3: Report results**

No commit needed for this task — verification only. Report pass/fail per item
above before moving to `finishing-a-development-branch`.
