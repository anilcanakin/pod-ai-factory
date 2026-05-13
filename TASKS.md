# POD AI Factory — Görev Panosu & Proje Durumu

Son güncelleme: 13 Mayıs 2026

---

## 🆕 SON TAMAMLANANLAR — Mockup & PSD Entegrasyonu (13 Mayıs 2026)

### Neler Eklendi
- **PSD Analiz Servisi** (`src/services/psd-analyzer.service.js`) — `psd.js` ile smart object bounds → kesin print area, shadow katmanı extraction, greyscale base PNG üretimi
- **Preset Shadow PNG'leri** (`assets/presets/shadows/`) — `scripts/create-preset-shadows.js` ile 6 kategori için Sharp+SVG tabanlı soft overlay shadow'lar (tshirt, hoodie, sweatshirt, mug, sticker, phone_case)
- **Bulk Upload PSD Desteği** — `.psd` fileFilter, 100 dosya limiti, PSD için `analyzePsd()` entegrasyonu, gray_base.png + shadow kaydı, `configJson.meta.isPsdDerived` flag
- **AI Shadow Generate Route** (`POST /api/mockups/templates/:id/generate-shadow`) — FAL.ai `fal-ai/imageutils/depth` depth estimation → invert+blur → shadow_ai.png
- **productColor Tint Render** — `productColor` parametresi, gray_base.png + Sharp `.tint()` → geçici dosya → base olarak kullan
- **Renk Picker** — `SHIRT_COLORS` 8 preset, localStorage, sadece `isPsdDerived` şablonlarda görünür
- **AI Shadow Butonu** — `Wand2` ikonu, `isPsdDerived && shadowSource !== 'ai'` koşulunda görünür
- **Path traversal güvenlik fix'i** — generate-shadow route'unda

### Teknik Notlar
- `psd.js` v3.4.0: layer bounds `node.coords` üzerinde (NOT `node.layer.coords`), pixel data `layer.image.toPng().data` (NOT `toBuffer()`)
- FAL.ai çağrılarında local path kullanılamaz → base64 `data:image/png;base64,...` formatı
- Shadow fallback: PSD'de shadow layer bulunamazsa `assets/presets/shadows/{category}_shadow.png` otomatik atanır

---

## ✅ TAMAMLANAN ÖZELLİKLER

### Temel Altyapı
- Çok kiracılı workspace sistemi (User, Workspace, WorkspaceMember, WorkspaceApiKey)
- Cookie tabanlı auth: POST /api/auth/login, /logout, GET /me
- Workspace middleware: session cookie'sinden workspaceId çıkarır
- secrets.service.js ile workspace başına API key geçersiz kılmaları (DB önce → env fallback)
- BullMQ + Redis iş kuyruğu (src/queues/asset.worker.js)
- Supabase storage bucket otomatik oluşturma (mockup-outputs, 50MB limit)
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
- "Etsy'de Yayımla (Taslak)" butonu

### AI Brain / Kurumsal Bellek
- Video ingestion: ffmpeg frame extraction + Whisper transkripsiyon + Claude Vision
- Metin/makale ingestion
- RAG sorgu testi
- Auto-merge: SEO içgörülerini SeoKnowledgeBase'e otomatik birleştirir
- Kategoriler: digital_products, etsy_algorithm, seo_tips, niche_research, pod_apparel, general_etsy
- Tüm AI üretimine (SEO, Factory, Ideas) evrensel knowledge enjeksiyonu

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

### Etsy Browser Otomasyonu
- Playwright: ilan formu doldurma, dispatch, scraping, Pinterest pin
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

## 🔴 YÜKSEK ÖNCELİK — Bekleyen

### 1. Etsy Resmi API Entegrasyonu
**Durum:** Etsy API key onayı bekleniyor.
**Mevcut geçici çözüm:** Playwright tarayıcı otomasyonu — kırılgan, Etsy UI değişikliklerinde bozulur.
**Key geldiğinde inşa edilecekler:**
- `src/routes/etsy.routes.js` oluştur (etsy-browser değil — resmi API için ayrı dosya)
- `GET /api/etsy/auth` — Etsy OAuth2 URL'sine yönlendir
- `GET /api/etsy/callback` — kodu access+refresh token ile değiştir, WorkspaceApiKey'e kaydet (provider='etsy')
- `POST /api/etsy/listings` — resmi Etsy v3 API ile ilan oluştur
- Token yenileme mantığı (Etsy token'ları 1 saatte sona erer)
- SEO + Galeri sayfasındaki "Etsy'de Yayımla" butonlarını resmi API kullanacak şekilde değiştir
- `src/index.js`'de route kaydet

### 2. Yuppion Fulfillment — Gerçek API Entegrasyonu
**Durum:** Mock uygulama, Yuppion API erişimi bekleniyor.
**Dosya:** `src/services/fulfillment.service.js`
**Mevcut:** `createOrder()` API key yoksa sahte `YUP-XXXXX` ID döner. `syncEtsyOrders()` 1 hardcoded mock sipariş döner.
**API erişimi geldiğinde:**
- `.env`'ye `YUPPION_API_KEY` ayarla
- `this.apiUrl` base URL'ini doğrula/güncelle
- `syncEtsyOrders()` mock'unu Etsy Orders API ile değiştir (Görev #1'den OAuth gerektirir)
- OrdersClient.tsx'i gerçek sipariş verisini gösterecek şekilde bağla
- Sipariş durum takibi ekle (polling veya webhook)

### 3. Billing Route Etkinleştirme
**Dosya:** `src/index.js` — `/api/billing` route'u comment'le devre dışı
**Yapılacaklar:**
- Stripe Dashboard'da Starter/Pro/Unlimited ürünleri oluştur
- `.env`'ye STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO, STRIPE_PRICE_UNLIMITED ekle
- `src/index.js`'deki `// app.use('/api/billing', ...)` satırının comment'ini kaldır
- Uçtan uca test: checkout → webhook → plan güncelleme

---

## 🟡 ORTA ÖNCELİK — Bekleyen

### 4. PSD Şablonlarla Gerçek Dosya Testi
- Creative Fabrica / gerçek ürün PSD'leri ile uçtan uca end-to-end test
- Smart object bounds doğruluğunu gerçek tasarım dosyalarıyla doğrula
- Render çıktılarını gerçek mockup görselleriyle karşılaştır

### 5. Bulk Render'da Per-Şablon Renk
**Mevcut:** Tüm batch için tek `productColor`
**Yapılacak:** MockupsClient.tsx'te toplu render modunda her şablon için ayrı renk seçici

### 6. Multi-Area Mockup UI
**Backend:** Zaten çalışıyor — `areaDesigns` map (alan ID → tasarım görseli) kabul eder ve her birini farklı composite eder
**Eksik:** Farklı tasarımları farklı şablon baskı alanlarına atamak için frontend UI. Çok panelli şablonlar için gerekli (kapüşonlularda ön/arka/kol).

### 7. Per-Model Maliyet Takibi
**Dosya:** `src/services/generation.service.js`
**Mevcut:** `FAL_COST_PER_IMAGE` tüm modeller için sabit oran. Flux Dev ~$0.03, Schnell ~$0.003, Ideogram ~$0.08.
**Düzeltme:** Model→maliyet haritası ekle ve doğru harcama takibi için üretim başına gerçek maliyet kullan.

### 8. Vektör Sayfası E2E Doğrulama
`frontend/app/dashboard/vector/` + `POST /api/tools/vectorize` mevcut. Endpoint'in uçtan uca çalıştığını ve hangi FAL modelinin çağrıldığını doğrula.

### 9. Semantik Arama (Corporate Memory)
`CorporateMemory.vectorEmbedding` alanı mevcut (Json) ama kosinüs benzerliği uygulanmamış. `/api/brain/test-knowledge` yalnızca metin eşleşmesi yapıyor.
**Düzeltme:** OpenAI text-embedding-3-small + kosinüs arama ekle (daha iyi RAG kalitesi için).

### 10. CORS Origin
**Mevcut:** `.env`'den okuyor (`CORS_ORIGIN`) — production'a deploy ederken doğru domain'i ayarlamayı unutma.

---

## 🔵 DÜŞÜK ÖNCELİK / Gelecek

### 11. Production Deployment
- `CORS_ORIGIN` env'ini production domain'e ayarla
- Production Redis yapılandır (şu an hardcoded localhost:6379)
- Production NEXT_PUBLIC_API_BASE_URL ayarla
- Node backend için process manager (PM2)
- SSL/HTTPS kurulumu

### 12. API Key Şifreleme
`WorkspaceApiKey.keyValue` düz metin olarak saklanıyor. Production'da gerçek müşteri API key'leri işlemeden önce AES-256 veya cloud KMS ile şifrele.

### 13. Rate Limiting
Route'larda rate limiting middleware yok. `/api/factory`, `/api/generate`, `/api/tools` endpoint'lerine express-rate-limit ekle. Ayrıca BullMQ kuyruğunda workspace.concurrentJobCap uygula (alan DB'de var ama enqueue öncesi kontrol edilmiyor).

### 14. Pinterest Resmi API
`pinToPinterest()` Playwright otomasyonu kullanıyor — kırılgan. Pinterest'in OAuth API'si var. Pinleme düzenli iş akışı adımı olursa değiştir.

### 15. Otomatik Etsy Performans Senkronizasyonu
ProductPerformance yalnızca CSV import ile dolduruluyor. Etsy OAuth canlı olduğunda, impressions/visits/favorites/orders'ı otomatik güncellemek için zamanlanmış polling ekle.

### 16. Displacement Map / Perspective Warp
Kumaş dokusuna göre tasarımı eğme — gerçekçi mockup efekti için.

### 17. Çoklu Smart Object Tespiti
Multi-area PSD desteği (ön/arka gibi birden fazla smart object olan PSD dosyaları).

### 18. YouTube Servisi Entegrasyonu
`src/services/youtube.service.js` mevcut. Frontend Brain sayfasına YouTube URL'den içerik ingestion ekleme.

---

## 🐛 BİLİNEN HATALAR

| # | Konum | Hata | Önem |
|---|-------|------|------|
| 1 | `src/services/fulfillment.service.js:60` | `syncEtsyOrders()` workspace'den bağımsız 1 hardcoded mock sipariş döner | Minor (beklenen) |
| 2 | `src/services/billing.service.js:121,198` | Stripe yapılandırılmamışsa checkout + portal mock localhost URL döner | Minor (yalnızca dev) |
| 3 | `src/index.js` | Billing route comment'li — deploy öncesi etkinleştirilmeli | Orta |

*Önceden belgelenen kritik hatalar (listing-assembler prisma.sEOContent, avgGenerationTime null) — düzeltildi.*

---

## 📝 GELİŞTİRME NOTLARI

### Portlar
- **Backend:** http://localhost:3001 (`.env`'deki PORT — index.js varsayılanı 3000 ama .env 3001'e zorlar)
- **Frontend:** http://localhost:3000
- **Redis:** localhost:6379 (hardcoded, env config yok — production için değiştir)
- **PostgreSQL:** `.env`'deki DATABASE_URL üzerinden

### Mimari Kararlar

**Çok kiracılı izolasyon:** Her DB sorgusu `req.workspaceId` ile filtreler (workspace middleware tarafından session cookie'sinden ayarlanır). Yeni route'lar MUTLAKA workspace kapsam filtrelemesi içermelidir.

**Sağlayıcı fallback:** Vision: Anthropic → Gemini → OpenAI (otomatik fallback). Üretim: kullanıcı seçimli model, otomatik fallback yok.

**API key çözümü (secrets.service.js):** WorkspaceApiKey DB → process.env → throw. Her workspace global key'leri geçersiz kılabilir.

**Etsy entegrasyonu (mevcut):** Playwright tarayıcı otomasyonu geçici çözüm olarak. Kalıcı Chrome oturumuyla Etsy'ye giriş yapar ve formları doldurur. Kırılgan — Etsy UI değişiklikleri sessizce bozar. Resmi API onaylandığında etsy-browser.service.js yalnızca scraping için tutulacak.

**Pipeline modları:**
- `/api/pipeline/one-click` = eşzamanlı (isteği bloke eder)
- `/api/pipeline/run` ve `/run-job/:jobId` = async via BullMQ
- `/api/batch/generate` = async via BullMQ (toplu niche üretimi)

**Knowledge enjeksiyonu:** Brain belleği SEO, Factory ve Ideas üreticilerine knowledge-context.service.js üzerinden context olarak enjekte edilir. SEO KB haftalık cron ile otomatik yenilenir.

**WPI Redis cache:** Tarama sonuçları `wpi:scan:<scanId>` key'i altında 72h TTL ile Redis'te saklanır. Bu, aynı niş için tekrarlanan taramalarda Apify maliyetinden tasarruf sağlar.

**Batch Factory:** `/api/batch/generate` → DesignJob anında oluşturulur → ağır iş (Claude + FAL) `batch-setup` kuyruğuna gider. Endpoint <100ms'de yanıt verir, proxy timeout riski yok.

**Image.seed alanı:** Mockup referansı için `designImageId` saklamak amacıyla yeniden kullanılmıştır.

**DesignJob.mode değerleri:**
- `'standard'` — normal factory üretimi
- `'etsy'` — Etsy modu üretimi
- `'batch'` — batch factory üretimi
- `'mockup_gallery'` — render edilmiş mockuplar (galeriden ayırt etmek için)

### Prisma Şeması — 21 Model
User, Workspace, WorkspaceMember, WorkspaceApiKey, DesignJob, Image, Mockup, SEOData, VisionAnalysis, JobLog, Idea, ProductPerformance, ProductPack, ProductPackItem, SeoKnowledgeBase, MockupTemplate, CorporateMemory, ApiUsage, DailyTask, StyleProfile, FinancialTransaction

### Tasarım Sistemi
- Accent: Electric Violet `#7c3aed` → `var(--accent)`
- Arka Plan: `#08090a`, Kartlar: `bg-[#111827]`
- Birincil CTA: `bg-gradient-to-r from-purple-600 to-blue-600`
- Yazı Tipi: Geist sans + Geist Mono
- Sidebar: 220px sabit, sol border aktif vurgu
- Token'lar `frontend/app/globals.css`'de — yalnızca mevcut token'ları kullan
