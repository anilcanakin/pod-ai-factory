const crypto            = require('crypto');
const prisma            = require('../lib/prisma');
const { encrypt, decrypt } = require('./secrets.service');
const FormData = require('form-data');
const axios    = require('axios');

// ─── JWT decode (Etsy access token'ından user_id çıkar) ───────────────────────

function _userIdFromToken(token) {
    try {
        const payload = token.split('.')[1];
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
        return decoded.user_id ? String(decoded.user_id) : null;
    } catch {
        return null;
    }
}

// ─── PKCE ─────────────────────────────────────────────────────────────────────

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

// ─── Token DB helpers ──────────────────────────────────────────────────────────

async function _saveTokens(workspaceId, { accessToken, refreshToken, expiresIn, shopId = null, shopName = null }) {
    const existing = await _loadTokens(workspaceId);
    const plain = JSON.stringify({
        accessToken,
        refreshToken,
        expiresAt: Date.now() + expiresIn * 1000,
        shopId:    shopId    ?? existing?.shopId    ?? null,
        shopName:  shopName  ?? existing?.shopName  ?? null,
    });
    await prisma.workspaceApiKey.upsert({
        where:  { workspaceId_provider: { workspaceId, provider: 'etsy' } },
        update: { keyValue: encrypt(plain) },
        create: { workspaceId, provider: 'etsy', keyValue: encrypt(plain) },
    });
}

async function _loadTokens(workspaceId) {
    if (!workspaceId) throw new Error('[Etsy] _loadTokens: workspaceId gerekli');
    const rec = await prisma.workspaceApiKey.findUnique({
        where: { workspaceId_provider: { workspaceId, provider: 'etsy' } },
    });
    if (!rec) return null;
    const raw = decrypt(rec.keyValue);
    if (!raw) return null;
    return JSON.parse(raw);
}

// ─── Rate limit takibi ─────────────────────────────────────────────────────────

function _trackRateLimit(res) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining === null) return;
    const n = parseInt(remaining, 10);
    if (n < 10)  throw new Error(`Etsy rate limit kritik: ${n} istek kaldı`);
    if (n < 100) console.warn(`[Etsy API] Rate limit uyarısı: ${n} istek kaldı`);
}

// ─── OAuth ────────────────────────────────────────────────────────────────────

async function getAuthUrl(workspaceId) {
    const verifier  = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    _pkceStore.set(workspaceId, { verifier, expiresAt: Date.now() + 10 * 60 * 1000 });

    const params = new URLSearchParams({
        response_type:         'code',
        client_id:             process.env.ETSY_API_KEY,
        redirect_uri:          process.env.ETSY_REDIRECT_URI,
        scope:                 'listings_w listings_r shops_r',
        state:                 workspaceId,
        code_challenge:        challenge,
        code_challenge_method: 'S256',
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

    // Mağaza bilgisini çek ve kaydet (hata olursa devam et — sonradan tekrar denenebilir)
    try {
        const shop = await _getShopInfo(workspaceId, data.access_token);
        await _saveTokens(workspaceId, {
            accessToken:  data.access_token,
            refreshToken: data.refresh_token,
            expiresIn:    data.expires_in,
            shopId:       shop.shopId,
            shopName:     shop.shopName,
        });
    } catch (shopErr) {
        console.warn('[Etsy] Mağaza bilgisi çekilemedi (token kaydedildi):', shopErr.message);
    }
}

async function _getShopInfo(workspaceId, accessToken) {
    const apiKey = `${process.env.ETSY_API_KEY}:${process.env.ETSY_API_SECRET}`;

    // 1. Önce JWT'den user_id çıkarmayı dene
    let userId = _userIdFromToken(accessToken);

    // 2. JWT decode başarısızsa /users/me ile çek
    if (!userId) {
        const meRes = await fetch('https://api.etsy.com/v3/application/users/me', {
            headers: { 'x-api-key': apiKey, Authorization: `Bearer ${accessToken}` },
        });
        if (!meRes.ok) {
            const body = await meRes.text();
            throw new Error(`Kullanıcı bilgisi alınamadı (${meRes.status}): ${body}`);
        }
        const me = await meRes.json();
        userId = String(me.user_id);
    }

    // 3. user_id ile mağaza bilgisini çek
    const shopRes = await fetch(
        `https://api.etsy.com/v3/application/users/${userId}/shops`,
        { headers: { 'x-api-key': apiKey, Authorization: `Bearer ${accessToken}` } },
    );
    _trackRateLimit(shopRes);
    if (!shopRes.ok) {
        const body = await shopRes.text();
        throw new Error(`Etsy mağaza bilgisi alınamadı (${shopRes.status}): ${body}`);
    }
    const data = await shopRes.json();
    const shop = Array.isArray(data?.results) ? data.results[0] : data;
    if (!shop?.shop_id) throw new Error('Mağaza verisi boş geldi');
    return { shopId: String(shop.shop_id), shopName: shop.shop_name };
}

async function refreshShopInfo(workspaceId) {
    const accessToken = await getValidToken(workspaceId);
    const shop = await _getShopInfo(workspaceId, accessToken);
    const tokens = await _loadTokens(workspaceId);
    await _saveTokens(workspaceId, { ...tokens, ...shop, expiresIn: Math.floor((tokens.expiresAt - Date.now()) / 1000) });
    return shop;
}

// ─── Token yönetimi ───────────────────────────────────────────────────────────

async function getValidToken(workspaceId) {
    const tokens = await _loadTokens(workspaceId);
    if (!tokens) {
        throw new Error("Etsy bağlantısı yok. Lütfen Settings sayfasından Etsy'ye bağlanın.");
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

async function getStatus(workspaceId) {
    const tokens = await _loadTokens(workspaceId);
    if (!tokens) return { connected: false };
    return {
        connected: true,
        shopId:    tokens.shopId,
        shopName:  tokens.shopName,
    };
}

// ─── Listing oluşturma ────────────────────────────────────────────────────────

async function createDraftListing(workspaceId, { title, description, tags, price, imageUrls }) {
    const accessToken = await getValidToken(workspaceId);
    const tokens      = await _loadTokens(workspaceId);

    if (!tokens.shopId) {
        throw new Error('Shop ID bulunamadı. Lütfen Etsy bağlantısını yenileyin.');
    }
    if (!process.env.ETSY_SHIPPING_PROFILE_ID) {
        throw new Error("ETSY_SHIPPING_PROFILE_ID .env'de eksik. Etsy'den alıp ekleyin.");
    }
    if (!process.env.ETSY_RETURN_POLICY_ID) {
        throw new Error("ETSY_RETURN_POLICY_ID .env'de eksik. Etsy'den alıp ekleyin.");
    }

    const safeTitle = (title || '').slice(0, 140);
    const safeTags  = (tags  || []).slice(0, 13).map(t => String(t).slice(0, 20));
    const priceFloat = parseFloat(price) || 19.99;

    const AI_DISCLOSURE = '\n\n---\nThis design was created using AI tools based on the seller\'s own original concept and creative direction, then prepared for print. Designed by the seller; produced and shipped by our production partner.';
    const baseDescription = description || '';
    const finalDescription = baseDescription.includes('This design was created using AI tools')
        ? baseDescription
        : baseDescription + AI_DISCLOSURE;

    const listingBody = {
        title:               safeTitle,
        description:         finalDescription,
        price:               priceFloat,
        quantity:            999,
        taxonomy_id:         parseInt(process.env.ETSY_TAXONOMY_ID || '2078', 10),
        who_made:            'i_did',
        when_made:           'made_to_order',
        is_supply:           false,
        production_partner_ids: [5454339],
        state:               'draft',
        ...(process.env.ETSY_READINESS_STATE_ID && { readiness_state_id: parseInt(process.env.ETSY_READINESS_STATE_ID, 10) }),
        tags:                safeTags,
        shipping_profile_id: parseInt(process.env.ETSY_SHIPPING_PROFILE_ID, 10),
        return_policy_id:    parseInt(process.env.ETSY_RETURN_POLICY_ID, 10),
    };

    const createRes = await fetch(
        `https://api.etsy.com/v3/application/shops/${tokens.shopId}/listings`,
        {
            method:  'POST',
            headers: {
                'x-api-key':    `${process.env.ETSY_API_KEY}:${process.env.ETSY_API_SECRET}`,
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

    // Etsy'nin listing'i DB'ye propagate etmesi için kısa bekleme
    await new Promise(r => setTimeout(r, 3000));

    for (let i = 0; i < (imageUrls || []).length; i++) {
        await _uploadImage(accessToken, tokens.shopId, listingId, imageUrls[i], i + 1);
    }

    return {
        listingId,
        listingUrl: `https://www.etsy.com/listing/${listingId}`,
    };
}

async function _uploadImage(accessToken, shopId, listingId, imageUrl, rank) {
    try {
        const imgRes = await fetch(imageUrl);
        if (!imgRes.ok) throw new Error(`Görsel indirilemedi (${imgRes.status}): ${imageUrl}`);
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        const ext    = (imageUrl.split('.').pop() || 'jpg').split('?')[0].toLowerCase();
        const mime   = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;

        const form = new FormData();
        form.append('image',          buffer, { filename: `img_${rank}.${ext}`, contentType: mime });
        form.append('rank',           String(rank));
        form.append('overwrite',      'false');
        form.append('is_watermarked', 'false');
        form.append('alt_text',       '');

        const resp = await axios.post(
            `https://api.etsy.com/v3/application/shops/${shopId}/listings/${listingId}/images`,
            form,
            {
                headers: {
                    ...form.getHeaders(),
                    'x-api-key':   `${process.env.ETSY_API_KEY}:${process.env.ETSY_API_SECRET}`,
                    Authorization: `Bearer ${accessToken}`,
                },
            }
        );
        console.log(`[Etsy API] Görsel ${rank} yüklendi — listing_image_id: ${resp.data?.listing_image_id}`);
    } catch (err) {
        const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        console.error(`[Etsy API] _uploadImage hata (rank ${rank}): ${detail}`);
    }
}

// ─── Inventory (varyasyonlar) ─────────────────────────────────────────────────

async function updateListingInventory(workspaceId, listingId) {
    const template     = require('../config/yuppion-variation-template');
    const accessToken  = await getValidToken(workspaceId);

    const body = JSON.stringify({
        products:                    template.products,
        price_on_property:           [513],
        quantity_on_property:        [],
        sku_on_property:             [],
        readiness_state_on_property: [],
    });

    const res = await fetch(
        `https://api.etsy.com/v3/application/listings/${listingId}/inventory`,
        {
            method:  'PUT',
            headers: {
                'x-api-key':    `${process.env.ETSY_API_KEY}:${process.env.ETSY_API_SECRET}`,
                Authorization:  `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body,
        }
    );
    _trackRateLimit(res);

    if (!res.ok) {
        const errText = await res.text();
        console.error(`[Etsy API] updateListingInventory hata (${res.status}): ${errText}`);
        throw new Error(`Etsy inventory güncelleme başarısız (${res.status}): ${errText}`);
    }

    const data = await res.json();
    console.log(`[Etsy API] Inventory güncellendi — listing ${listingId}, ${template.productCount} variant`);
    return { ok: true, listingId, productCount: template.productCount, data };
}

module.exports = { getAuthUrl, exchangeCode, getValidToken, getStatus, refreshShopInfo, createDraftListing, updateListingInventory };
