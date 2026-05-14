# Etsy Resmi API Entegrasyonu — Implementation Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Playwright tabanlı Etsy ilan yayımlama akışını OAuth 2.0 PKCE + Etsy v3 resmi API ile değiştir.

**Architecture:** `etsy-api.service.js` tüm token yönetimini (PKCE üretimi, exchange, auto-refresh) ve listing oluşturmayı kapsar. `etsy-api.routes.js` OAuth callback + listing endpoint'lerini barındırır. Frontend Settings sayfasına bağlantı kartı eklenir, SEO ve Gallery sayfalarındaki Playwright endpoint'leri resmi API'ye yönlendirilir.

**Tech Stack:** Node.js crypto (PKCE), native fetch (Node 18+), Prisma (WorkspaceApiKey), Next.js 14, React Query

---

## Dosya Haritası

| Eylem | Dosya | Ne Değişiyor |
|-------|-------|-------------|
| Yeni | `src/services/etsy-api.service.js` | PKCE, OAuth, token yönetimi, listing oluşturma |
| Yeni | `src/routes/etsy-api.routes.js` | auth, callback, status, disconnect, listings |
| Değişiyor | `src/index.js` | Yeni route kaydı |
| Değişiyor | `src/routes/etsy-browser.routes.js` | `/create-draft` ve `/dispatch` siliniyor |
| Değişiyor | `frontend/lib/api.ts` | `apiEtsy` nesnesi güncelleniyor |
| Değişiyor | `frontend/app/dashboard/settings/SettingsClient.tsx` | Etsy bağlantı kartı ekleniyor |
| Değişiyor | `frontend/app/dashboard/seo/SeoClient.tsx` | Endpoint değişiyor |
| Değişiyor | `frontend/app/dashboard/gallery/GalleryClient.tsx` | `apiEtsy.dispatch` → `apiEtsy.createListing` |

---

## Task 1: etsy-api.service.js — PKCE + OAuth akışı

**Files:**
- Create: `src/services/etsy-api.service.js`

- [ ] **Adım 1: Dosyayı oluştur — PKCE yardımcıları ve token helpers**

`src/services/etsy-api.service.js` dosyasını oluştur:

```js
const crypto = require('crypto');
const prisma = require('../lib/prisma');

// ─── PKCE ────────────────────────────────────────────────────────────────────

function generateCodeVerifier() {
    return crypto.randomBytes(64).toString('base64url');
}

function generateCodeChallenge(verifier) {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// Geçici PKCE store — workspaceId → { verifier, expiresAt }
const _pkceStore = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of _pkceStore) {
        if (v.expiresAt < now) _pkceStore.delete(k);
    }
}, 60_000);

// ─── Token DB helpers ─────────────────────────────────────────────────────────

async function _saveTokens(workspaceId, { accessToken, refreshToken, expiresIn, shopId = null, shopName = null }) {
    const existing = await _loadTokens(workspaceId);
    const keyValue = JSON.stringify({
        accessToken,
        refreshToken,
        expiresAt: Date.now() + expiresIn * 1000,
        shopId:   shopId   ?? existing?.shopId   ?? null,
        shopName: shopName ?? existing?.shopName ?? null,
    });
    await prisma.workspaceApiKey.upsert({
        where:  { workspaceId_provider: { workspaceId, provider: 'etsy' } },
        update: { keyValue },
        create: { workspaceId, provider: 'etsy', keyValue },
    });
}

async function _loadTokens(workspaceId) {
    const rec = await prisma.workspaceApiKey.findUnique({
        where: { workspaceId_provider: { workspaceId, provider: 'etsy' } },
    });
    return rec ? JSON.parse(rec.keyValue) : null;
}

// ─── Rate limit takibi ────────────────────────────────────────────────────────

function _trackRateLimit(res) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining === null) return;
    const n = parseInt(remaining, 10);
    if (n < 10)  throw new Error(`Etsy rate limit kritik: ${n} istek kaldı`);
    if (n < 100) console.warn(`[Etsy API] Rate limit uyarısı: ${n} istek kaldı`);
}

module.exports = { generateCodeVerifier, generateCodeChallenge, _saveTokens, _loadTokens };
```

- [ ] **Adım 2: Sözdizimini doğrula**

```bash
node -e "require('./src/services/etsy-api.service')" && echo OK
```

Beklenen çıktı: `OK`

- [ ] **Adım 3: getAuthUrl ve exchangeCode ekle**

`module.exports = ...` satırının hemen üstüne ekle:

```js
// ─── OAuth ───────────────────────────────────────────────────────────────────

async function getAuthUrl(workspaceId) {
    const verifier   = generateCodeVerifier();
    const challenge  = generateCodeChallenge(verifier);
    _pkceStore.set(workspaceId, { verifier, expiresAt: Date.now() + 10 * 60 * 1000 });

    const params = new URLSearchParams({
        response_type:          'code',
        client_id:              process.env.ETSY_API_KEY,
        redirect_uri:           process.env.ETSY_REDIRECT_URI,
        scope:                  'listings_w listings_r',
        state:                  workspaceId,
        code_challenge:         challenge,
        code_challenge_method:  'S256',
    });
    return `https://www.etsy.com/oauth/connect?${params.toString()}`;
}

async function exchangeCode(workspaceId, code) {
    const entry = _pkceStore.get(workspaceId);
    if (!entry || entry.expiresAt < Date.now()) {
        throw new Error('PKCE verifier süresi dolmuş. Lütfen tekrar bağlanmayı deneyin.');
    }
    _pkceStore.delete(workspaceId);

    const body = new URLSearchParams({
        grant_type:    'authorization_code',
        client_id:     process.env.ETSY_API_KEY,
        redirect_uri:  process.env.ETSY_REDIRECT_URI,
        code,
        code_verifier: entry.verifier,
    });

    const res = await fetch('https://api.etsy.com/v3/public/oauth/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Etsy token exchange başarısız: ${err}`);
    }
    const data = await res.json();

    await _saveTokens(workspaceId, {
        accessToken:  data.access_token,
        refreshToken: data.refresh_token,
        expiresIn:    data.expires_in,
    });

    // Mağaza bilgisini çek ve kaydet
    const shop = await _getShopInfo(workspaceId, data.access_token);
    await _saveTokens(workspaceId, {
        accessToken:  data.access_token,
        refreshToken: data.refresh_token,
        expiresIn:    data.expires_in,
        shopId:       shop.shopId,
        shopName:     shop.shopName,
    });
}

async function _getShopInfo(workspaceId, accessToken) {
    const res = await fetch('https://api.etsy.com/v3/application/users/me/shops', {
        headers: {
            'x-api-key':    process.env.ETSY_API_KEY,
            Authorization:  `Bearer ${accessToken}`,
        },
    });
    _trackRateLimit(res);
    if (!res.ok) throw new Error('Etsy mağaza bilgisi alınamadı');
    const data = await res.json();
    return { shopId: String(data.shop_id), shopName: data.shop_name };
}
```

Module.exports'u güncelle:

```js
module.exports = { getAuthUrl, exchangeCode, getValidToken, getStatus, createDraftListing };
```

> Not: `getValidToken`, `getStatus`, `createDraftListing` sonraki adımlarda eklenecek — şimdilik export'ta tutulabilir, sonra çalışır.

- [ ] **Adım 4: Sözdizimini tekrar doğrula**

```bash
node -e "require('./src/services/etsy-api.service')" && echo OK
```

Beklenen: `OK`

- [ ] **Adım 5: Commit**

```bash
git add src/services/etsy-api.service.js
git commit -m "feat: etsy-api.service — PKCE helpers + OAuth flow"
```

---

## Task 2: etsy-api.service.js — Token yönetimi ve getStatus

**Files:**
- Modify: `src/services/etsy-api.service.js`

- [ ] **Adım 1: getValidToken fonksiyonunu ekle**

`exchangeCode` fonksiyonunun hemen altına ekle:

```js
async function getValidToken(workspaceId) {
    const tokens = await _loadTokens(workspaceId);
    if (!tokens) {
        throw new Error('Etsy bağlantısı yok. Lütfen Settings sayfasından Etsy\'ye bağlanın.');
    }

    // 5 dakika buffer — token henüz geçerliyse direkt döndür
    if (tokens.expiresAt - 5 * 60 * 1000 > Date.now()) {
        return tokens.accessToken;
    }

    // Token süresi dolmuş — refresh et
    const body = new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     process.env.ETSY_API_KEY,
        refresh_token: tokens.refreshToken,
    });
    const res = await fetch('https://api.etsy.com/v3/public/oauth/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    if (!res.ok) {
        throw new Error('Etsy token yenileme başarısız. Lütfen Settings sayfasından yeniden bağlanın.');
    }
    const data = await res.json();
    await _saveTokens(workspaceId, {
        accessToken:  data.access_token,
        refreshToken: data.refresh_token || tokens.refreshToken,
        expiresIn:    data.expires_in,
        shopId:       tokens.shopId,
        shopName:     tokens.shopName,
    });
    return data.access_token;
}
```

- [ ] **Adım 2: getStatus fonksiyonunu ekle**

`getValidToken`'ın hemen altına ekle:

```js
async function getStatus(workspaceId) {
    const tokens = await _loadTokens(workspaceId);
    if (!tokens) return { connected: false };
    return {
        connected: true,
        shopId:    tokens.shopId,
        shopName:  tokens.shopName,
    };
}
```

- [ ] **Adım 3: Sözdizimini doğrula**

```bash
node -e "
const s = require('./src/services/etsy-api.service');
console.log(typeof s.getValidToken, typeof s.getStatus);
" && echo OK
```

Beklenen: `function function OK`

- [ ] **Adım 4: Commit**

```bash
git add src/services/etsy-api.service.js
git commit -m "feat: etsy-api.service — getValidToken auto-refresh + getStatus"
```

---

## Task 3: etsy-api.service.js — createDraftListing

**Files:**
- Modify: `src/services/etsy-api.service.js`

- [ ] **Adım 1: createDraftListing fonksiyonunu ekle**

`getStatus`'ün hemen altına ekle:

```js
async function createDraftListing(workspaceId, { title, description, tags, price, imageUrls }) {
    const accessToken = await getValidToken(workspaceId);
    const tokens      = await _loadTokens(workspaceId);

    if (!tokens.shopId) {
        throw new Error('Shop ID bulunamadı. Lütfen Etsy bağlantısını yenileyin.');
    }
    if (!process.env.ETSY_SHIPPING_PROFILE_ID) {
        throw new Error('ETSY_SHIPPING_PROFILE_ID .env\'de eksik. Etsy\'den alıp ekleyin.');
    }
    if (!process.env.ETSY_RETURN_POLICY_ID) {
        throw new Error('ETSY_RETURN_POLICY_ID .env\'de eksik. Etsy\'den alıp ekleyin.');
    }

    const safeTitle  = (title || '').slice(0, 140);
    const safeTags   = (tags  || []).slice(0, 13).map(t => String(t).slice(0, 20));
    const priceAmt   = Math.round(parseFloat(price) * 100);

    const listingBody = {
        title:                safeTitle,
        description:          description || '',
        price:                { amount: priceAmt, divisor: 100, currency_code: 'USD' },
        quantity:             999,
        taxonomy_id:          parseInt(process.env.ETSY_TAXONOMY_ID || '2078', 10),
        who_made:             'i_did',
        when_made:            'made_to_order',
        is_supply:            false,
        state:                'draft',
        tags:                 safeTags,
        shipping_profile_id:  parseInt(process.env.ETSY_SHIPPING_PROFILE_ID, 10),
        return_policy_id:     parseInt(process.env.ETSY_RETURN_POLICY_ID, 10),
    };

    const createRes = await fetch(
        `https://api.etsy.com/v3/application/shops/${tokens.shopId}/listings`,
        {
            method:  'POST',
            headers: {
                'x-api-key':    process.env.ETSY_API_KEY,
                Authorization:  `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(listingBody),
        }
    );
    _trackRateLimit(createRes);
    if (!createRes.ok) {
        const err = await createRes.text();
        throw new Error(`Etsy listing oluşturma başarısız: ${err}`);
    }
    const listing   = await createRes.json();
    const listingId = listing.listing_id;

    // Görselleri yükle
    for (let i = 0; i < (imageUrls || []).length; i++) {
        await _uploadImage(accessToken, listingId, imageUrls[i], i + 1);
    }

    return {
        listingId,
        listingUrl: `https://www.etsy.com/listing/${listingId}`,
    };
}

async function _uploadImage(accessToken, listingId, imageUrl, rank) {
    try {
        const imgRes = await fetch(imageUrl);
        if (!imgRes.ok) throw new Error(`Görsel indirilemedi: ${imageUrl}`);
        const buffer    = Buffer.from(await imgRes.arrayBuffer());
        const ext       = (imageUrl.split('.').pop() || 'jpg').split('?')[0].toLowerCase();
        const mimeType  = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;

        const blob     = new Blob([buffer], { type: mimeType });
        const formData = new FormData();
        formData.append('image',          blob, `img_${rank}.${ext}`);
        formData.append('rank',           String(rank));
        formData.append('overwrite',      'false');
        formData.append('is_watermarked', 'false');
        formData.append('alt_text',       '');

        const uploadRes = await fetch(
            `https://api.etsy.com/v3/application/listings/${listingId}/images`,
            {
                method:  'POST',
                headers: {
                    'x-api-key':   process.env.ETSY_API_KEY,
                    Authorization: `Bearer ${accessToken}`,
                },
                body: formData,
            }
        );
        _trackRateLimit(uploadRes);
        if (!uploadRes.ok) {
            const err = await uploadRes.text();
            console.error(`[Etsy API] Görsel ${rank} yükleme başarısız: ${err}`);
            // Listing oluşturuldu — görsel hatası critical değil
        }
    } catch (err) {
        console.error(`[Etsy API] _uploadImage hata (rank ${rank}):`, err.message);
    }
}
```

- [ ] **Adım 2: Sözdizimini doğrula**

```bash
node -e "
const s = require('./src/services/etsy-api.service');
console.log(typeof s.createDraftListing);
" && echo OK
```

Beklenen: `function OK`

- [ ] **Adım 3: Commit**

```bash
git add src/services/etsy-api.service.js
git commit -m "feat: etsy-api.service — createDraftListing + image upload"
```

---

## Task 4: etsy-api.routes.js

**Files:**
- Create: `src/routes/etsy-api.routes.js`

- [ ] **Adım 1: Route dosyasını oluştur**

```js
const express  = require('express');
const router   = express.Router();
const prisma   = require('../lib/prisma');
const etsyApi  = require('../services/etsy-api.service');

// GET /api/etsy-api/auth — Etsy OAuth akışını başlat
router.get('/auth', async (req, res) => {
    try {
        if (!req.workspaceId) return res.status(401).json({ error: 'Unauthorized' });
        const url = await etsyApi.getAuthUrl(req.workspaceId);
        res.redirect(url);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/etsy-api/callback — Etsy'den dönen code'u token ile değiştir
router.get('/callback', async (req, res) => {
    const { code, state: workspaceId, error } = req.query;
    if (error) {
        return res.redirect(`/dashboard/settings?etsy_error=${encodeURIComponent(error)}`);
    }
    if (!code || !workspaceId) {
        return res.status(400).send('Eksik parametreler');
    }
    try {
        await etsyApi.exchangeCode(String(workspaceId), String(code));
        res.redirect('/dashboard/settings?etsy_connected=1');
    } catch (err) {
        res.redirect(`/dashboard/settings?etsy_error=${encodeURIComponent(err.message)}`);
    }
});

// GET /api/etsy-api/status — Bağlantı durumu
router.get('/status', async (req, res) => {
    try {
        if (!req.workspaceId) return res.status(401).json({ error: 'Unauthorized' });
        const status = await etsyApi.getStatus(req.workspaceId);
        res.json(status);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/etsy-api/disconnect — Token kaydını sil
router.delete('/disconnect', async (req, res) => {
    try {
        if (!req.workspaceId) return res.status(401).json({ error: 'Unauthorized' });
        await prisma.workspaceApiKey.deleteMany({
            where: { workspaceId: req.workspaceId, provider: 'etsy' },
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/etsy-api/listings — Draft listing oluştur
// Body seçenek 1 (Gallery): { imageId, price? }
// Body seçenek 2 (SEO):     { title, description, tags, imageUrls, price? }
router.post('/listings', async (req, res) => {
    try {
        if (!req.workspaceId) return res.status(401).json({ error: 'Unauthorized' });

        const { imageId, title, description, tags, imageUrls, price } = req.body;
        const resolvedPrice = parseFloat(price) || parseFloat(process.env.DEFAULT_LISTING_PRICE) || 19.99;

        let listingData;

        if (imageId) {
            // DB'den SEO ve mockup görsellerini çek
            const image = await prisma.image.findFirst({
                where:   { id: imageId, job: { workspaceId: req.workspaceId } },
                include: { seoData: true, mockups: true },
            });
            if (!image) return res.status(404).json({ error: 'Görsel bulunamadı' });
            if (!image.seoData) {
                return res.status(400).json({ error: 'Bu görsel için SEO verisi yok. Önce SEO oluşturun.' });
            }
            listingData = {
                title:       image.seoData.title,
                description: image.seoData.description,
                tags:        image.seoData.tags,
                price:       resolvedPrice,
                imageUrls:   image.mockups.length > 0
                    ? image.mockups.map(m => m.mockupUrl)
                    : [image.imageUrl],
            };
        } else {
            // Ham veri (SEO sayfasından)
            if (!title || !description || !tags) {
                return res.status(400).json({ error: 'title, description, tags gerekli' });
            }
            listingData = { title, description, tags, imageUrls: imageUrls || [], price: resolvedPrice };
        }

        const result = await etsyApi.createDraftListing(req.workspaceId, listingData);
        res.json({ success: true, ...result });
    } catch (err) {
        const statusCode = err.message.includes('bağlantısı yok') ? 401 : 500;
        res.status(statusCode).json({ error: err.message });
    }
});

module.exports = router;
```

- [ ] **Adım 2: Sözdizimini doğrula**

```bash
node -e "require('./src/routes/etsy-api.routes')" && echo OK
```

Beklenen: `OK`

- [ ] **Adım 3: Commit**

```bash
git add src/routes/etsy-api.routes.js
git commit -m "feat: etsy-api.routes — auth, callback, status, disconnect, listings"
```

---

## Task 5: index.js — Route kaydı

**Files:**
- Modify: `src/index.js`

- [ ] **Adım 1: Yeni route'u kaydet**

`src/index.js`'de `app.use('/api/etsy-browser', ...)` satırının hemen üstüne ekle:

```js
app.use('/api/etsy-api', require('./routes/etsy-api.routes'));
```

- [ ] **Adım 2: Backend'in ayağa kalktığını doğrula**

```bash
node -e "
process.env.DATABASE_URL='postgresql://x';
// Sadece require kontrolü
try { require('./src/index.js') } catch(e) { if (!e.message.includes('EADDRINUSE') && !e.message.includes('connect')) throw e; }
console.log('OK');
"
```

> Alternatif: Dev sunucusu çalışıyorsa sadece kaydet ve konsol hatasını izle.

- [ ] **Adım 3: Commit**

```bash
git add src/index.js
git commit -m "feat: index.js — /api/etsy-api route kaydı"
```

---

## Task 6: Playwright listing kodunu kaldır

**Files:**
- Modify: `src/routes/etsy-browser.routes.js`
- Modify: `src/services/etsy-browser.service.js`

- [ ] **Adım 1: etsy-browser.routes.js'den /create-draft ve /dispatch sil**

`src/routes/etsy-browser.routes.js` dosyasından şu blokları tamamen sil:

```js
// POST /api/etsy-browser/create-draft   (5-20. satırlar arası)
router.post('/create-draft', async (req, res) => {
    ...
});

// POST /api/etsy-browser/dispatch   (33-43. satırlar arası)
router.post('/dispatch', async (req, res) => {
    ...
});
```

Dosyada yalnızca `/scrape` ve `/pin-pinterest` endpoint'leri kalacak.

- [ ] **Adım 2: etsy-browser.service.js'den createEtsyDraft sil**

`src/services/etsy-browser.service.js` dosyasında:

1. `createEtsyDraft` fonksiyonunu bul (`async function createEtsyDraft(listing)` — yaklaşık satır 98)
2. Fonksiyonun tüm gövdesini (kapanan `}` dahil) sil
3. Dosyanın sonundaki `module.exports` satırını bul ve `createEtsyDraft` ifadesini çıkar:

```js
// Eski:
module.exports = { launchBrowser, createEtsyDraft, scrapeListings, pinToPinterest, getListingStats, updateListing };

// Yeni:
module.exports = { launchBrowser, scrapeListings, pinToPinterest, getListingStats, updateListing };
```

- [ ] **Adım 3: Sözdizimini doğrula**

```bash
node -e "require('./src/routes/etsy-browser.routes')" && echo OK
node -e "require('./src/services/etsy-browser.service')" && echo OK
```

Her ikisi de `OK` bekleniyor.

- [ ] **Adım 4: Commit**

```bash
git add src/routes/etsy-browser.routes.js src/services/etsy-browser.service.js
git commit -m "feat: Playwright listing kodu kaldırıldı — resmi API'ye geçildi"
```

---

## Task 7: Frontend — api.ts güncelleme

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Adım 1: apiEtsy nesnesini güncelle**

`frontend/lib/api.ts` dosyasında `apiEtsy` objesini bul (satır ~663) ve şununla değiştir:

```typescript
export const apiEtsy = {
    pinToPinterest: (pin: PinterestPin) =>
        request<{ success: boolean }>('/etsy-browser/pin-pinterest', {
            method: 'POST', body: JSON.stringify(pin),
        }),

    // Resmi API — listing oluşturma
    createListing: (imageId: string, price?: number) =>
        request<{ success: boolean; listingId: number; listingUrl: string }>('/etsy-api/listings', {
            method: 'POST', body: JSON.stringify({ imageId, price }),
        }),

    createListingRaw: (data: { title: string; description: string; tags: string[]; imageUrls: string[]; price?: number }) =>
        request<{ success: boolean; listingId: number; listingUrl: string }>('/etsy-api/listings', {
            method: 'POST', body: JSON.stringify(data),
        }),

    // OAuth yönetimi
    status: () =>
        request<{ connected: boolean; shopId?: string; shopName?: string }>('/etsy-api/status'),

    disconnect: () =>
        request<{ success: boolean }>('/etsy-api/disconnect', { method: 'DELETE' }),

    connect: () => {
        window.location.href = `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/etsy-api/auth`;
    },
};
```

- [ ] **Adım 2: TypeScript derleme hatası yok mu kontrol et**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Hata olmamalı veya yalnızca alakasız uyarılar görülmeli.

- [ ] **Adım 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat: api.ts — apiEtsy resmi API fonksiyonları"
```

---

## Task 8: Settings sayfası — Etsy bağlantı kartı

**Files:**
- Modify: `frontend/app/dashboard/settings/SettingsClient.tsx`

- [ ] **Adım 1: State ve useEffect ekle**

`SettingsClient.tsx` dosyasında mevcut state tanımlarının altına ekle:

```tsx
const [etsyStatus, setEtsyStatus] = useState<{ connected: boolean; shopName?: string } | null>(null);

useEffect(() => {
    apiEtsy.status()
        .then(setEtsyStatus)
        .catch(() => setEtsyStatus({ connected: false }));

    // OAuth callback sonrası URL param kontrolü
    const params = new URLSearchParams(window.location.search);
    if (params.get('etsy_connected')) {
        toast.success('Etsy bağlantısı kuruldu!');
        apiEtsy.status().then(setEtsyStatus);
        window.history.replaceState({}, '', '/dashboard/settings');
    }
    if (params.get('etsy_error')) {
        toast.error(`Etsy bağlantı hatası: ${params.get('etsy_error')}`);
        window.history.replaceState({}, '', '/dashboard/settings');
    }
}, []);

const handleEtsyDisconnect = async () => {
    await apiEtsy.disconnect();
    setEtsyStatus({ connected: false });
    toast.success('Etsy bağlantısı kesildi');
};
```

- [ ] **Adım 2: Etsy bağlantı kartını JSX'e ekle**

Settings sayfasındaki mevcut kartların altına (API Keys bölümünün hemen öncesine ya da sonrasına) ekle:

```tsx
{/* Etsy Bağlantısı */}
<div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-6">
    <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-600/20 border border-orange-500/30 flex items-center justify-center">
                <Store className="w-4.5 h-4.5 text-orange-400" />
            </div>
            <div>
                <h3 className="text-sm font-semibold text-white">Etsy Bağlantısı</h3>
                <p className="text-xs text-slate-400">Resmi Etsy API v3</p>
            </div>
        </div>
        {etsyStatus?.connected && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Bağlı
            </span>
        )}
    </div>

    {etsyStatus === null ? (
        <p className="text-xs text-slate-500">Yükleniyor...</p>
    ) : etsyStatus.connected ? (
        <div className="flex items-center justify-between">
            <p className="text-sm text-slate-300">
                Mağaza: <span className="text-white font-medium">{etsyStatus.shopName}</span>
            </p>
            <button
                onClick={handleEtsyDisconnect}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
            >
                Bağlantıyı Kes
            </button>
        </div>
    ) : (
        <button
            onClick={apiEtsy.connect}
            className="w-full py-2 bg-orange-600/20 hover:bg-orange-600/30 border border-orange-500/30 text-orange-400 text-sm font-medium rounded-xl transition-colors"
        >
            Etsy'ye Bağlan
        </button>
    )}
</div>
```

- [ ] **Adım 3: `Store` import'unu ekle (zaten yoksa)**

Dosyanın en üstündeki Lucide import satırına `Store` ekle:

```tsx
import { ..., Store } from 'lucide-react';
```

- [ ] **Adım 4: TypeScript kontrol**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Adım 5: Commit**

```bash
git add frontend/app/dashboard/settings/SettingsClient.tsx
git commit -m "feat: Settings — Etsy bağlantı kartı"
```

---

## Task 9: SEO sayfası — endpoint güncelleme

**Files:**
- Modify: `frontend/app/dashboard/seo/SeoClient.tsx`

- [ ] **Adım 1: handlePublishToEtsy fonksiyonunu güncelle**

`SeoClient.tsx`'te `handlePublishToEtsy` fonksiyonunu bul (satır ~98) ve şununla değiştir:

```tsx
const handlePublishToEtsy = async () => {
    if (!result) return;
    setPublishing(true);
    try {
        const data = await apiEtsy.createListingRaw({
            title:       result.title,
            description: result.description,
            tags:        result.tags,
            imageUrls:   sourceImage ? [sourceImage] : [],
        });
        setPublishResult(`Etsy'de taslak oluşturuldu!`);
        toast.success(
            <span>
                Etsy taslak oluşturuldu!{' '}
                <a href={data.listingUrl} target="_blank" rel="noreferrer" className="underline">
                    İlanı Görüntüle
                </a>
            </span>
        );
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Bilinmeyen hata';
        toast.error(msg.includes('bağlantısı yok')
            ? 'Etsy bağlantısı yok — Settings\'ten bağlanın'
            : `Yayımlama hatası: ${msg}`
        );
    } finally {
        setPublishing(false);
    }
};
```

- [ ] **Adım 2: `apiEtsy` import'unu kontrol et**

Dosyanın üstünde `apiEtsy`'nin import edildiğini doğrula:

```tsx
import { ..., apiEtsy } from '@/lib/api';
```

Yoksa ekle.

- [ ] **Adım 3: Commit**

```bash
git add frontend/app/dashboard/seo/SeoClient.tsx
git commit -m "feat: SEO sayfası — Etsy yayımlama resmi API'ye geçildi"
```

---

## Task 10: Gallery sayfası — dispatch güncelleme

**Files:**
- Modify: `frontend/app/dashboard/gallery/GalleryClient.tsx`

- [ ] **Adım 1: apiEtsy.dispatch çağrılarını güncelle**

`GalleryClient.tsx`'te `apiEtsy.dispatch` olan tüm yerleri `apiEtsy.createListing` ile değiştir:

```tsx
// Eski (2 yerde var — satır ~140 ve ~274):
const result = await apiEtsy.dispatch(imgId);
// ...
const result = await apiEtsy.dispatch(id);

// Yeni:
const result = await apiEtsy.createListing(imgId);
// ...
const result = await apiEtsy.createListing(id);
```

- [ ] **Adım 2: Başarı toast'unu listingUrl ile güncelle**

Şu an hata olmayan başarı mesajına listingUrl linki ekle. `result` tipinde `listingUrl` alanı var:

```tsx
if (data.listingUrl) {
    toast.success(
        <span>
            Etsy taslak oluşturuldu!{' '}
            <a href={data.listingUrl} target="_blank" rel="noreferrer" className="underline">
                Görüntüle
            </a>
        </span>
    );
} else {
    toast.success('Etsy taslak oluşturuldu!');
}
```

- [ ] **Adım 3: TypeScript kontrol**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Adım 4: Commit**

```bash
git add frontend/app/dashboard/gallery/GalleryClient.tsx
git commit -m "feat: Gallery — Etsy dispatch resmi API'ye geçildi"
```

---

## Task 11: Ortam kurulumu + OAuth testi

**Files:**
- Modify: `.env`

- [ ] **Adım 1: Etsy developer portalında redirect URI ekle**

1. https://www.etsy.com/developers/your-apps adresine git
2. Onaylanan app'e tıkla → "App Details" veya "Manage"
3. Redirect URI alanına ekle: `http://localhost:3001/api/etsy-api/callback`
4. Kaydet

- [ ] **Adım 2: .env'ye eksik değerleri ekle**

`.env` dosyasına şunları ekle/doğrula:

```env
ETSY_API_KEY=<developer portalındaki keystring>
ETSY_API_SECRET=<developer portalındaki shared secret>
ETSY_REDIRECT_URI=http://localhost:3001/api/etsy-api/callback
ETSY_TAXONOMY_ID=2078
# Aşağıdakiler ilk bağlantıdan SONRA Etsy dashboard'dan alınacak:
# ETSY_SHIPPING_PROFILE_ID=
# ETSY_RETURN_POLICY_ID=
```

- [ ] **Adım 3: Dev sunucusunu yeniden başlat**

```bash
npm run dev
```

- [ ] **Adım 4: OAuth akışını test et**

1. Tarayıcıda http://localhost:3000/dashboard/settings aç
2. "Etsy'ye Bağlan" butonuna tıkla
3. Etsy onay sayfasına yönlendirildiğini doğrula
4. İzin ver → `http://localhost:3000/dashboard/settings?etsy_connected=1`'e döndüğünü gör
5. "Bağlı ✓ Mağaza: [AdınMağaza]" göründüğünü doğrula

- [ ] **Adım 5: Shipping ve Return Policy ID'leri al**

Etsy bağlantısı kurulduktan sonra:
1. https://www.etsy.com/your/shops/me/tools/shipping adresinden shipping profile ID'yi al
2. https://www.etsy.com/your/shops/me/tools/policies adresinden return policy ID'yi al
3. `.env`'ye ekle:

```env
ETSY_SHIPPING_PROFILE_ID=<id>
ETSY_RETURN_POLICY_ID=<id>
```

4. Backend'i yeniden başlat: `npm run dev:backend`

- [ ] **Adım 6: İlk gerçek listing testi**

1. Gallery sayfasında SEO verisi olan bir görsele git
2. Etsy publish butonuna tıkla
3. "Etsy taslak oluşturuldu — İlanı Görüntüle" toast'u gör
4. Linke tıkla → Etsy seller dashboard'da taslak ilanı doğrula
5. Rate limit logunu kontrol et: `[Etsy API] Rate limit uyarısı: X istek kaldı` (henüz çok düşük olmamalı)

- [ ] **Adım 7: Son commit ve push**

```bash
git add .env
git push origin main
```

> Not: `.env` gitignore'da olabilir. Sadece `.env.example`'ı commit'le:

```bash
# .env push etme — sadece örnek dosyayı güncelle
grep -E "^ETSY_" .env | sed 's/=.*/=/' >> .env.example
git add .env.example
git commit -m "feat: Etsy API entegrasyonu tamamlandı"
git push origin main
```

---

## Özet

| Task | Açıklama | Dosya |
|------|----------|-------|
| 1 | PKCE + OAuth flow | etsy-api.service.js |
| 2 | Token yönetimi | etsy-api.service.js |
| 3 | Listing oluşturma | etsy-api.service.js |
| 4 | Route'lar | etsy-api.routes.js |
| 5 | Route kaydı | index.js |
| 6 | Playwright temizliği | etsy-browser.* |
| 7 | API client | api.ts |
| 8 | Settings kartı | SettingsClient.tsx |
| 9 | SEO endpoint | SeoClient.tsx |
| 10 | Gallery endpoint | GalleryClient.tsx |
| 11 | Env + OAuth test | .env |
