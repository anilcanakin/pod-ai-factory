# POD AI Factory — Görev Panosu & Proje Durumu

Son güncelleme: 15 Mayıs 2026

---

## 🆕 SON TAMAMLANANLAR (15 Mayıs 2026)

- **Etsy Resmi API Entegrasyonu** — OAuth2 PKCE, token yenileme, `createDraftListing`, görsel yükleme (`/shops/{id}/listings/{id}/images`), `/api/etsy/dispatch` endpoint'i, SEO sayfası Playwright fallback kaldırıldı
- **Brain Görsel İşleme** — 307 görsel (expert + social) başarıyla CorporateMemory'ye aktarıldı
- **BullMQ workspaceId null fix** — knowledge worker ve routes'ta `|| 'default-workspace'` guard eklendi
- **Media type fix** — PNG/WebP görseller Claude Vision'a doğru `media_type` ile gönderiliyor

---

## ✅ TAMAMLANAN ÖZELLİKLER

### Temel Altyapı
- Çok kiracılı workspace sistemi (User, Workspace, WorkspaceMember, WorkspaceApiKey)
- Cookie tabanlı auth: POST /api/auth/login, /logout, GET /me
- Workspace middleware: session cookie'sinden workspaceId çıkarır
- secrets.service.js ile workspace başına API key geçersiz kılmaları (DB önce → env fallback)
- BullMQ + Redis iş kuyruğu (src/queues/asset.worker.js) — SSH sunucu localhost:6379
- Yerel `assets/` storage (uploads, outputs, mockups) — Supabase yok
- Görsel başına maliyet takibi (Image.cost alanı, günlük/aylık agregasyon)
- Workspace başına günlük görsel cap + eşzamanlı iş cap
- Global hata işleyici + health check (GET /health)

### Factory Pipeline
- Çok sağlayıcı vision analizi (Anthropic → Gemini → OpenAI fallback)
- Prompt varyasyonları + knowledge context enjeksiyonu
- FAL.ai ile görsel üretim (Flux Dev/Schnell, Ideogram, Recraft)
- Başarısız işleri yeniden deneme
- Etsy modu: keyword → niche → style → üretim
- Toplu yükleme: 8 görsel, ayrı analiz → varyasyonlar
- Prompt geçmişi (localStorage, son 10)
- "Mockup'a" ve "BG Kaldır'a" butonları

### Gallery & Pipeline
- Görsel onaylama/reddetme/silme/yeniden üretme
- Toplu işlemler (seç hepsini, onayla, reddet, pipeline)
- One-click pipeline: BG Kaldır → Mockup → SEO tek istekte
  - BG model seçici: birefnet / bria pro / pixelcut
  - 5 şablona kadar render
  - Vision → keyword → Claude Haiku → SEO çıktısı

### Araçlar (Tools)
- BG Kaldırma: BiRefNet / Bria / Pixelcut (5 görsel toplu)
- Upscale: ESRGAN / AuraSR / Ideogram (1x–8x)
- Vektörize: Recraft v3 PNG → SVG
- Birleşik sekme tabanlı arayüz (`?tab=` URL param ile persist)

### Mockup Sistemi
- Sharp tabanlı compositing motoru
- Çoklu baskı alanı desteği (printAreas dizisi, tek printArea backward compat)
- Konva tabanlı DesignPlacementEditor
- Dark/light şablon varyantı toggle
- Kling-video ile video mockup
- Toplu render + per-şablon durum gösterimi
- "Galeriye Kaydet" + "Pinterest'e Sabitle"
- PSD desteği: smart object bounds, shadow extraction, renk picker

### SEO
- Etsy SEO üretimi: başlık ≤140, açıklama, 13 etiket
- Etsy 2026 algoritma bilgisi dahil varsayılan KB
- Haftalık otomatik güncelleme (cron)
- SEO kopyalama yardımcısı + checklist
- "Etsy'de Yayımla" — Resmi Etsy v3 API ile taslak oluşturma ✅

### Etsy Entegrasyonu
- OAuth2 PKCE akışı: auth URL, callback, token exchange, auto-refresh
- `POST /api/etsy/listings` — resmi API ile ilan oluşturma
- `POST /api/etsy/dispatch` — imageId → SEO+mockup assembly → ilan
- Görsel yükleme: `form-data` + `axios`, shop-scoped endpoint
- Settings sayfası: Etsy bağlan/kopar UI
- Galeri dispatch: resmi API'ye yönlendirildi
- Gerekli env'ler: ETSY_API_KEY, ETSY_API_SECRET, ETSY_REDIRECT_URI, ETSY_SHIPPING_PROFILE_ID, ETSY_RETURN_POLICY_ID, ETSY_READINESS_STATE_ID

### AI Brain / Kurumsal Bellek
- Video ingestion: ffmpeg frame extraction + Whisper transkripsiyon + Claude Vision
- Metin/makale ingestion
- RAG sorgu testi
- Auto-merge: SEO içgörülerini SeoKnowledgeBase'e otomatik birleştirir
- Kategoriler: digital_products, etsy_algorithm, seo_tips, niche_research, pod_apparel, general_etsy
- Tüm AI üretimine (SEO, Factory, Ideas) evrensel knowledge enjeksiyonu
- 307 expert/social görsel işlendi (scripts/process-brain-images.js)

### WPI — Winning Product Intelligence
- Apify Etsy scraping + Claude derinlemesine niş analizi
- Redis'te 72h cache
- WPI verisiyle SEO üretimi
- Frontend: niş giriş, tarama ilerlemesi, sonuç kartları

### Scout
- Google Trends + Pinterest → Claude Haiku → 5 mikro-niş öneri
- Önerileri CorporateMemory'ye kaydetme

### HQ Dashboard
- Günlük görev takibi (MOCKUP/SEO/ETSY_DRAFT hedefleri, her biri 100 hedef)
- Finansal hedef tahmini (draft başına gelir tahmini)
- FLAGGED görsel taraması (legal guard)

### Batch Factory
- Niche → Claude prompt üretim → FAL.ai → çoklu görsel (async BullMQ)
- Proxy timeout yok — endpoint <100ms'de yanıt verir
- 20 görsel maks, iş durumu takibi

### Style Profiles
- StyleProfile CRUD (isim, emoji, baseModel, prefix/suffix, negativePrompt, referenceImage, colorPalette)
- Varsayılan profil ayarı
- Kilitli seed/DNA'dan yeni profil

### Finansal İzleme
- FinancialTransaction modeli (gelir/gider)
- Manuel Etsy satış kaydı
- Gelir/gider özet raporu

### Otonom Ajan
- Gemini ile mağaza denetimi → aksiyon planı
- UPDATE_PRICE / UPDATE_SEO Playwright ile çalıştırma

### Etsy Browser (Playwright — Scraping için tutuluyor)
- Playwright: ilan scraping, Pinterest pin
- Etsy Listings sayfası: ilan tara, "SEO Optimize" (öncesi/sonrası)

### Diğer Tamamlananlar
- Bildirim sistemi (workspace başına in-memory, bell + okunmamış badge)
- Product Packs CRUD
- Analitik CSV import + performans tablosu
- Dışa aktarma: ZIP bundle, Etsy CSV
- Rakip radar (Playwright scraper)
- Haftalık trendler + sezonluk takvim
- Apify entegrasyonu (Etsy ürünleri, Pinterest trendleri)
- Global klavye kısayolları: Ctrl+Shift+F/G/S/M
- ApiUsage maliyet takip modeli
- DailyTask otomatik hedef sistemi
- Dark/light mod toggle

---

## 🆕 SON TAMAMLANANLAR (15 Mayıs 2026 — Devam)

- **Yuppion Ürün Katalog Sistemi** — `data/yuppion-catalog.json` (14 model, 150 renk), `yuppion-catalog.service.js`, `GET/POST /api/fulfillment/catalog` + CSV/JSON import endpoint'leri
- **Garment Renk Tespiti** — Sharp ile JPG/PNG mockup yükleme sırasında otomatik giysi rengi analizi, Redmean formülüyle katalog eşleştirme (tolerance=100)
- **Katalog Bağlantısı** — Template editor'da Yuppion Model ID atama (BC3001, CC1717 vb.) → PSD şablonlar katalog renklerini seçici olarak gösterir
- **Stok Dışı Filtreleme** — Bulk render'da "Stok dışı atla" toggle → eşleşmeyen JPG/PNG template'ler sarı "Atlandı" kartıyla gösterilir
- **`long_sleeve`, `tank`, `polo`** kategorileri backend + frontend'e eklendi

---

## 🔴 YÜKSEK ÖNCELİK — Bekleyen

### 1. ~~Brain — Kalan PDF'leri Yükle~~ ✅
30 PDF + 2 video + 152 görsel kuyruğa alındı. Twitter klasörü gelince tekrar çalıştır.

### 2. ~~Semantik Arama (Corporate Memory RAG)~~ ✅
JS cosine similarity ile pgvector'suz çalışıyor. 3509 kayıt içinde sorguya göre en alakalı chunk'ları buluyor. `getSeoContext(workspaceId, query)` ve `getFactoryContext(workspaceId, query)` artık keyword bazlı vektör araması yapıyor.

### 3. ~~Otomatik Etsy Performans Senkronizasyonu~~ ✅
`POST /api/etsy/sync-performance` eklendi. `SEOData.etsyListingId` alanı eklendi (migration yapıldı). Listing oluştururken ID kaydediliyor. Analytics sayfasında "Etsy'den Senkronize Et" butonu eklendi.

---

## 🟡 ORTA ÖNCELİK — Bekleyen

### 4. ~~PSD Şablonlarla Gerçek Dosya Testi~~ ✅
5 gerçek PSD yüklendi (24.psd, 25.psd, 26.psd, PSD.psd, T Shirt Mockup.psd). Smart object tespiti, gray_base.png üretimi, renk tinting, render-batch 4/4 başarılı. Tekil upload route'a PSD analiz dalı eklendi.

### 5. ~~Bulk Render'da Per-Şablon Renk~~ ✅
Bulk modda PSD şablonlar için her şablona özel renk seçici eklendi. Backend `render-batch` `productColors: Record<templateId, hex>` kabul ediyor.

### 6. ~~Multi-Area Mockup UI~~ ✅
Alan listesi + per-alan tasarım picker (DesignPickerModal), canvas'ta her alan için tasarım önizleme, `areaDesigns` map backend'e doğru iletiliyor. `downloadToTemp` yerel path'leri de destekliyor.

### 7. ~~Per-Model Maliyet Takibi~~ ✅
`MODEL_COSTS` haritası zaten `generation.service.js`'de mevcut. Flux Dev $0.03, Schnell $0.003, Ideogram $0.08, Recraft $0.04.

### 8. ~~YouTube Brain Ingestion UI~~ ✅
Brain sayfasında YouTube sekmesi zaten mevcut (URL + kanal tarama).

---

## 🔵 DÜŞÜK ÖNCELİK / Gelecek

### ~~9. Production Deployment~~ ✅ (Kısmen)
PM2 SSH sunucuda çalışıyor: `factory-backend` (id:0) + `factory-frontend` (id:1).
⚠️ **factory-backend 4470 restart** — crash loop var, kök nedeni araştırılmalı (`pm2 logs factory-backend --lines 50`).

### ~~10. API Key Şifreleme~~ ✅
AES-256-GCM zaten `secrets.service.js`'de mevcuttu. `migrate-encrypt-keys.js` ile 1 Etsy key şifrelendi. ENCRYPTION_KEY SSH `.env`'de.

### ~~11. Rate Limiting~~ ✅
`express-rate-limit` eklendi. 4 katman: auth (15/5dk), aiHeavy (60/dk), aiContent (40/dk), general (300/dk). `src/config/rate-limit.middleware.js`.

### 12. Pinterest Resmi API
`pinToPinterest()` Playwright kullanıyor — kırılgan. Pinterest OAuth API'sine geçiş.

### ~~13. Displacement Map / Perspective Warp~~ ✅
`applyDisplacementMap()` — bilinear inverse-warp, shadow layer kullanıyor. Template editor'da 0–25px slider.

### ~~14. Çoklu Smart Object (PSD)~~ ✅
`findAllSmartLayers()` + `printAreas[]` dizisi. Front/Back/Sleeve etiketleri. Backward compat korundu.

---

## ⏸️ MUALLAKTA (Harici Bağımlılık)

### Yuppion Fulfillment
**Durum:** API erişimi bekleniyor. Mock uygulama hazır (`fulfillment.service.js`).
**Gelince yapılacak:** `.env`'ye `YUPPION_API_KEY` ekle, `createOrder()` + `syncEtsyOrders()` gerçek API'ye geçir.

### Twitter/X İçerik Ingestion
**Durum:** Kullanıcı `.txt` dosyalarını hazırlayınca işlenecek.
**Yapılacak:** `ETSY/twitter/` klasörüne ekle → `node scripts/ingest-etsy-resources.js` çalıştır.

---

## 🐛 BİLİNEN HATALAR

| # | Konum | Hata | Önem |
|---|-------|------|------|
| 1 | `src/services/fulfillment.service.js:60` | `syncEtsyOrders()` 1 hardcoded mock sipariş döner | Minor (beklenen) |
| 2 | `src/index.js` | Billing route tamamen kaldırıldı — Stripe devre dışı | - |

---

## 📝 GELİŞTİRME NOTLARI

### Portlar
- **Backend:** http://localhost:3001
- **Frontend:** http://localhost:3000
- **Redis:** localhost:6379 (hardcoded — production için değiştir)

### Mimari Kararlar

**Çok kiracılı izolasyon:** Her DB sorgusu `req.workspaceId` ile filtreler. Yeni route'lar MUTLAKA workspace kapsam filtrelemesi içermelidir.

**Sağlayıcı fallback:** Vision: Anthropic → Gemini → OpenAI. Üretim: kullanıcı seçimli model.

**Etsy entegrasyonu:** Resmi OAuth2 PKCE + v3 API aktif. `etsy-browser.service.js` yalnızca scraping + Pinterest pin için korunuyor.

**Pipeline modları:**
- `/api/pipeline/one-click` = eşzamanlı
- `/api/pipeline/run` ve `/run-job/:jobId` = async BullMQ
- `/api/batch/generate` = async BullMQ (toplu niche üretimi)

**Knowledge enjeksiyonu:** Brain belleği tüm AI üretimine `knowledge-context.service.js` üzerinden enjekte edilir.

**WPI Redis cache:** `wpi:scan:<scanId>` — 72h TTL.

**Image.seed:** `designImageId` saklamak için yeniden kullanılmış.

**DesignJob.mode değerleri:** `standard` / `etsy` / `batch` / `mockup_gallery`

### Prisma Şeması — 21 Model
User, Workspace, WorkspaceMember, WorkspaceApiKey, DesignJob, Image, Mockup, SEOData, VisionAnalysis, JobLog, Idea, ProductPerformance, ProductPack, ProductPackItem, SeoKnowledgeBase, MockupTemplate, CorporateMemory, ApiUsage, DailyTask, StyleProfile, FinancialTransaction
