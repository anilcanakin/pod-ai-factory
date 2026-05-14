# Etsy Resmi API Entegrasyonu — Tasarım Dokümanı

Tarih: 14 Mayıs 2026  
Kapsam: OAuth 2.0 PKCE akışı + Etsy v3 API ile draft listing oluşturma  
Durum: Onaylandı

---

## Bağlam

Etsy API başvurusu onaylandı. 4 günlük deneme süresi, 5K istek limiti. Mevcut Playwright tabanlı ilan yayımlama akışı resmi API ile değiştirilecek. Playwright yalnızca scraping fonksiyonları için korunacak.

---

## Kapsam Dışı

- Sipariş okuma / Yuppion fulfillment bağlantısı
- Listing güncelleme (fiyat/SEO)
- Etsy shop analytics okuma
- Çoklu mağaza desteği

---

## Mimari

### Yeni Dosyalar

```
src/
├── routes/
│   └── etsy-api.routes.js        # OAuth + listing endpoint'leri
└── services/
    └── etsy-api.service.js       # Tüm Etsy API mantığı
```

### Değiştirilen Dosyalar

```
src/
├── index.js                      # Yeni route kaydı
├── routes/
│   └── etsy-browser.routes.js   # /dispatch ve /create-draft kaldırılır
└── services/
    └── etsy-browser.service.js  # createEtsyDraft() ve dispatch mantığı kaldırılır

frontend/
├── app/dashboard/settings/SettingsClient.tsx   # Etsy bağlantı kartı
├── app/dashboard/seo/SeoClient.tsx             # API endpoint değişimi
├── app/dashboard/gallery/GalleryClient.tsx     # dispatch butonu değişimi
└── lib/api.ts                                  # Yeni API fonksiyonları
```

---

## Backend Tasarımı

### `src/services/etsy-api.service.js`

**PKCE Yardımcıları**
```
generateCodeVerifier()   → 64 byte random → base64url string
generateCodeChallenge(verifier) → sha256(verifier) → base64url string
```

**OAuth Akışı**
```
getAuthUrl(workspaceId)
  → code_verifier üretir
  → memory store'a { workspaceId → verifier } yazar (TTL: 10 dakika)
  → Etsy OAuth URL döner:
    https://www.etsy.com/oauth/connect
      ?response_type=code
      &client_id={ETSY_API_KEY}
      &redirect_uri={ETSY_REDIRECT_URI}
      &scope=listings_w%20listings_r
      &state={workspaceId}
      &code_challenge={challenge}
      &code_challenge_method=S256

exchangeCode(workspaceId, code)
  → memory store'dan verifier'ı al
  → POST https://api.etsy.com/v3/public/oauth/token
  → { access_token, refresh_token, expires_in } alır
  → WorkspaceApiKey'e kaydeder:
      provider = 'etsy'
      keyValue = JSON.stringify({
        accessToken, refreshToken,
        expiresAt: Date.now() + expires_in * 1000,
        shopId: null   // ilk bağlantıda null, getShopId() ile doldurulur
      })
  → getShopId() çağırır, shopId'yi günceller
```

**Token Yönetimi**
```
getValidToken(workspaceId)
  → WorkspaceApiKey'ten etsy kaydını oku
  → expiresAt - 5 dakika > now ise mevcut accessToken döner
  → Aksi halde: POST /v3/public/oauth/token (grant_type=refresh_token)
  → Yeni token'ları DB'ye yaz, accessToken döner
```

**Listing Oluşturma**
```
createDraftListing(workspaceId, { title, description, tags, price, imageUrls[] })
  → getValidToken() ile geçerli token al
  → POST /v3/application/shops/{shopId}/listings
      body: {
        title,           // SEOData.title (max 140 karakter)
        description,     // SEOData.description
        tags,            // SEOData.tags (max 13 etiket, her biri max 20 karakter)
        price: { amount: price * 100, divisor: 100, currency_code: 'USD' },
        quantity: 999,   // POD için sonsuz stok
        taxonomy_id: 2078, // "Clothing > Shirts & Tops" — varsayılan
        who_made: 'i_did',
        when_made: 'made_to_order',
        is_supply: false,
        state: 'draft',
        shipping_profile_id: {ETSY_SHIPPING_PROFILE_ID},  // env'den
        return_policy_id: {ETSY_RETURN_POLICY_ID},        // env'den
      }
  → Dönen listingId için her görsel:
      POST /v3/application/listings/{listingId}/images
      multipart: { image: buffer, rank: i+1 }
  → { listingId, listingUrl } döner

getShopId(workspaceId)
  → GET /v3/application/users/me/shops
  → shops[0].shop_id döner, DB'ye yazar
```

**Rate Limit Takibi**
```
Her Etsy API yanıtında:
  X-RateLimit-Remaining header'ı okunur
  < 100 ise console.warn('[Etsy API] Rate limit düşük: X kalan')
  < 10 ise Error fırlatır: 'Etsy rate limit kritik seviyede'
```

---

### `src/routes/etsy-api.routes.js`

| Metod | Path | Açıklama |
|-------|------|----------|
| GET | `/api/etsy-api/auth` | OAuth URL üret, Etsy'ye yönlendir |
| GET | `/api/etsy-api/callback` | Code → token exchange, `/dashboard/settings`'e yönlendir |
| GET | `/api/etsy-api/status` | Bağlantı durumu + shopName döner |
| DELETE | `/api/etsy-api/disconnect` | WorkspaceApiKey provider='etsy' kaydını sil |
| POST | `/api/etsy-api/listings` | Draft listing oluştur |

**POST /api/etsy-api/listings — Body:**
```json
{
  "imageId": "uuid",
  "price": 19.99
}
```
Servis, `imageId`'den SEOData ve Mockup görsellerini kendi çeker.

---

## Token Saklama

Mevcut `WorkspaceApiKey` tablosu kullanılır — migration yok.

```
workspaceId: req.workspaceId
provider:    'etsy'
keyValue:    '{"accessToken":"...", "refreshToken":"...", "expiresAt":1234567890, "shopId":"12345678"}'
```

---

## Frontend Tasarımı

### Settings sayfası — Etsy Bağlantısı kartı

**Bağlı değil:**
```
[ Etsy İkonu ]  Etsy Bağlantısı
Henüz bağlanmadı
[  Etsy'ye Bağlan  ]
```

**Bağlı:**
```
[ Etsy İkonu ]  Etsy Bağlantısı          ● Bağlı
Mağaza: YourShopName
                                    [ Bağlantıyı Kes ]
```

### SEO sayfası

`POST /api/etsy-browser/create-draft` → `POST /api/etsy-api/listings`

Başarı mesajı: "Etsy'de taslak oluşturuldu — [İlanı Görüntüle]" (listingUrl linki)

### Gallery sayfası

dispatch butonu aynı endpoint değişikliğini alır.

### `frontend/lib/api.ts` — Yeni fonksiyonlar

```typescript
apiEtsy.status()           → GET /api/etsy-api/status
apiEtsy.disconnect()       → DELETE /api/etsy-api/disconnect
apiEtsy.createListing(imageId, price)  → POST /api/etsy-api/listings
```

---

## Silinen Kod

**`src/services/etsy-browser.service.js`'den kaldırılacaklar:**
- `createEtsyDraft()` fonksiyonu
- İlgili Playwright listing form doldurma mantığı
- `dispatchListing()` / listing assembler entegrasyonu

**Korunacaklar:**
- `scrapeListings()` — Etsy Listings sayfası için
- `pinToPinterest()` — Pinterest entegrasyonu için
- `updateListing()` — İleride ajan kullanabilir

**`src/routes/etsy-browser.routes.js`'den kaldırılacaklar:**
- `POST /api/etsy-browser/create-draft`
- `POST /api/etsy-browser/dispatch`

---

## Environment Değişkenleri

```env
ETSY_API_KEY=...             # Etsy developer portalından (client_id)
ETSY_API_SECRET=...          # Etsy developer portalından (client_secret)
ETSY_REDIRECT_URI=http://localhost:3001/api/etsy-api/callback

# Etsy mağaza ayarları — ilk bağlantıdan sonra Etsy dashboard'dan alınır
ETSY_SHIPPING_PROFILE_ID=...
ETSY_RETURN_POLICY_ID=...
ETSY_TAXONOMY_ID=2078        # Varsayılan: Clothing > Shirts & Tops
```

---

## Önkoşullar (Deployment Öncesi)

1. Etsy developer portalında app settings'e git
2. Redirect URI ekle: `http://localhost:3001/api/etsy-api/callback`
3. `.env`'ye ETSY_API_KEY ve ETSY_API_SECRET ekle
4. İlk OAuth bağlantısı sonrası Etsy dashboard'dan shipping_profile_id ve return_policy_id al
5. `.env`'ye ETSY_SHIPPING_PROFILE_ID ve ETSY_RETURN_POLICY_ID ekle

---

## Rate Limit Stratejisi

- 5K / 4 gün = ~1250 istek/gün
- Listing başına: 1 (create) + N görsel (upload) = ortalama 4 istek
- Güvenli günlük listing: ~300
- Kalan her yanıtta loglanır, 100 altında uyarı, 10 altında hata

---

## Hata Senaryoları

| Senaryo | Davranış |
|---------|----------|
| Token süresi dolmuş | `getValidToken()` otomatik refresh eder |
| Refresh token geçersiz | 401 → frontend'e "Etsy bağlantısını yenile" mesajı |
| Rate limit aşıldı (429) | 429 hatası kullanıcıya iletilir |
| shopId henüz yok | `getShopId()` çağrılır, kaydedilir, devam edilir |
| Görsel yükleme başarısız | Listing yine de oluşturulur, hata loglanır |
| Eksik shipping/return ID | 400 hatası + "ETSY_SHIPPING_PROFILE_ID eksik" mesajı |
