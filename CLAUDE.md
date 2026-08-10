## ⚡ TOKEN DİSİPLİNİ (önce bunu oku)
- DAR çalış: sana verilen net dosya + net değişikliği yap. Tüm repoyu tarama.
- SUBAGENT AÇMA: general-purpose/code-reviewer dispatch PAHALI (3.7M token/$1.5). Gerekmedikçe açma.
- "Araştır ve bul" denmedikçe araştırma; spesifik dosya verildiyse direkt onu düzenle.
- Bağlam için önce STATE.md oku — baştan keşif yapma.
- Şu klasörleri context'e ALMA (zaten .gitignore'da, ağır): assets/ (320M), node_modules/, frontend/.next/, *.png.
- Basit iş = minimal diff. Büyük refactor önerme, istenени yap.
- Commit mesajı kısa. Force-push yok, .env'e dokunma, onaysız migration yok, "* copy" üretme.
# POD AI Factory — CLAUDE.md

Son güncelleme: 15 Mayıs 2026

---

## Onay Kuralları

- Kod yazarken, test çalıştırırken, commit atarken onay sorma — direkt yap.
- Sadece destructive git işlemlerinde (force push, hard reset, branch silme) sor.
- Her commit sonrası otomatik olarak push et, kullanıcıya ayrıca sormaya gerek yok — "Onaylıyor musun?" onayı zaten push dahil tüm işlemi kapsar. İstisna: kullanıcı açıkça "push etme, önce göreyim" derse bekle.
- Yeni template/composite değişikliklerini önce staging'de (http://100.96.119.102:3010, backend :3002) test et, sorunsuzsa production'a al. Staging kurulumu: [[STATE.md#staging]], `ecosystem.staging.config.js`, `.env.staging`.

---

## ⚠️ Altyapı DNA — Her AI Asistanın Bilmesi Gereken

Bu proje **tamamen kendi SSH sunucusunda** çalışır. Hiçbir bulut servisi yok:

| Servis | Durum | Gerçek konum |
|--------|-------|--------------|
| Veritabanı (PostgreSQL) | ✅ SSH sunucuda | `100.96.119.102:5432` — `sudo -u postgres psql` |
| Dosya depolama | ✅ SSH sunucuda | `assets/uploads/`, `assets/outputs/`, `assets/mockups/` |
| Job Queue (Redis) | ✅ Upstash cloud | `equal-warthog-71312.upstash.io:6379` — BullMQ için |
| Supabase | ❌ HİÇ YOK | Önerilmez, kullanılmaz, söz bile edilmez |
| S3 / CDN / Object Storage | ❌ HİÇ YOK | Her şey yerel `assets/` dizininde |

**Yeni bir AI asistanın yapmaması gerekenler:** Supabase, Redis Cloud, S3, Vercel Blob, Firebase Storage veya herhangi bir bulut storage/DB servisi önermek. Tüm öneriler kendi SSH sunucusunu varsaymalıdır.

---

## AI Asistan Kuralları

- **Düzenlemeden önce oku.** Herhangi bir değişiklik yapmadan önce dosyanın tamamını oku. Tüm düzenlemeleri önce planla, sonra TEK ve eksiksiz bir düzenleme yap. Aynı dosya bir oturumda 3+ kez düzenlendiyse dur ve orijinal gereksinimleri yeniden oku.
- **Hedeften sapma.** Her birkaç turda bir orijinal isteği yeniden oku; hedeften uzaklaştığını doğrula.
- **Tam olarak uygula.** Yanıt vermeden önce kullanıcının son mesajını yeniden oku. Her talimatı eksiksiz uygula — yarım bırakma.
- **Düzeltmede dur ve onayla.** Kullanıcı seni düzelttiğinde dur, mesajı yeniden oku, ne istendiğini söze dök ve devam etmeden önce onayla.
- **Dil Protokolü:** Arayüz, planlar ve sistem promptları profesyonel, doğal Türkçe olmalı. Teknik değişken adları ve DB anahtarları (örn. `hafta_n`) değişmeden kalır.

---

## Proje Özeti

POD AI Factory, minimum insan müdahalesiyle bir Etsy Print-on-Demand işini yürütmek için tasarlanmış AI destekli otomasyon platformu. Sahip (Anılcan) tam uçtan uca otomasyon istiyor:

**Tam pipeline hedefi:**
1. Referans görsel yükle / trend bul
2. AI analiz eder, tasarım promptları üretir
3. Çok modelli görsel üretim (Flux / Ideogram / Recraft)
4. Arka plan kaldırma + upscaling
5. Ürün şablonlarına mockup render
6. Etsy SEO üretimi (başlık / açıklama / 13 etiket)
7. Etsy taslak ilanı yayımla (şu an Playwright, resmi API onaylandığında)
8. Sipariş gelir → otomatik Yuppion POD fabrikasına yönlendir
9. Performans takip et → AI Brain'e geri besle → sonraki döngüyü iyileştir

**Mevcut durum (Mayıs 2026):**
- Adım 1–7 tamamen inşa edildi ve çalışıyor.
- PSD şablonu desteği, toplu yükleme, AI gölge üretimi, ürün renk picker eklendi.
- Adım 8–9 mock / harici API bekleniyor.
- WPI (Winning Product Intelligence), Scout, HQ Dashboard, Batch Factory, Style Profiles, Finansal Intelligence modülleri eklendi.

---

## Tech Stack

| Katman | Teknoloji | Notlar |
|--------|-----------|--------|
| Backend | Node.js + Express 5 | `src/index.js`, port 3001 |
| Frontend | Next.js 14 App Router + React 19 | `frontend/`, port 3000 |
| Veritabanı | PostgreSQL + Prisma ORM 5.15 | 21 model — SSH sunucu `100.96.119.102:5432` |
| Job Queue | BullMQ + Redis | **Upstash cloud Redis** (`equal-warthog-71312.upstash.io:6379`) |
| Depolama | Yerel `assets/` dizini | SSH sunucusunda — Supabase/S3/CDN YOK |
| Vision AI | Anthropic Claude (birincil) → Google Gemini → OpenAI | Otomatik fallback zinciri |
| Görsel Üretim | FAL.ai — Flux Dev, Flux Schnell, Ideogram, Recraft | |
| BG Kaldırma | BiRefNet (ücretsiz), Bria Pro, Pixelcut | hepsi FAL.ai üzerinden |
| Upscaling | ESRGAN, AuraSR, Ideogram | 1x–8x |
| Tarayıcı Otomasyonu | Playwright + Chromium | Etsy / Pinterest / scraping |
| UI Framework | Tailwind CSS v4, Radix UI, Lucide icons | |
| Canvas | Konva + react-konva | mockup yerleştirme editörü |
| Grafikler | Recharts | haftalık istatistikler |
| Formlar | React Hook Form + Zod | |
| State | TanStack React Query | tüm API çağrıları |
| Görsel İşleme | Sharp | mockup compositing, PSD tint |
| PSD Analiz | psd.js v3.4.0 | smart object bounds, shadow layer |
| Scraping | Apify | Etsy ürün verisi, Pinterest trendleri |
| Ses Dönüşümü | ffmpeg + OpenAI Whisper | video ses transkripsiyon |

---

## Projeyi Çalıştırma

```bash
# Her şeyi başlat (önce 3000+3001 portlarını öldürür, sonra her ikisini başlatır)
npm run dev

# Ayrı ayrı
npm run dev:backend    # nodemon src/index.js (assets/ ignored)
npm run dev:frontend   # next dev

# Production
npm start
```

- Backend: http://localhost:3001
- Frontend: http://localhost:3000
- Frontend, backend'i `NEXT_PUBLIC_API_BASE_URL` env değişkeni üzerinden çağırır
- **Not:** `src/index.js` PORT'u varsayılan 3000 yapıyor ama `.env` 3001'e zorluyor. Her zaman `.env`'yi kontrol et.

---

## Proje Yapısı

```
pod-ai-factory/
├── src/                                # Backend (Node.js/Express)
│   ├── index.js                        # Giriş noktası: middleware, route kayıtları, özel endpoint'ler, server
│   ├── routes/                         # 36 route dosyası — her özellik alanı için bir tane
│   │   ├── agent.routes.js             # Otonom mağaza denetimi
│   │   ├── analytics.routes.js         # CSV import + performans tablosu
│   │   ├── apify.routes.js             # Apify Etsy/Pinterest scraping
│   │   ├── auth.routes.js              # Login/logout/me
│   │   ├── batch.routes.js             # Toplu tasarım üretimi (BullMQ kuyruğu)
│   │   ├── billing.routes.js           # Stripe (şu an DEVRE DIŞI — index.js'de comment'li)
│   │   ├── brain.routes.js             # Kurumsal bellek / AI Brain
│   │   ├── etsy-browser.routes.js      # Playwright Etsy otomasyonu
│   │   ├── export.routes.js            # ZIP/CSV dışa aktarma
│   │   ├── factory.routes.js           # Ana üretim pipeline
│   │   ├── finance.routes.js           # Finansal işlem özeti
│   │   ├── fulfillment.routes.js       # Yuppion POD siparişleri (mock)
│   │   ├── gallery.routes.js           # Görsel galeri yönetimi
│   │   ├── generation.routes.js        # Görsel üretim
│   │   ├── hq.routes.js                # HQ dashboard istatistikleri + legal guard
│   │   ├── idea.routes.js              # Fikir üretme ve yönetimi
│   │   ├── job.routes.js               # Tekil iş sorguları
│   │   ├── jobs.routes.js              # İş geçmişi listesi
│   │   ├── knowledge.routes.js         # Bilgi dosyası yükleme (BullMQ kuyruğu, 1GB)
│   │   ├── mockup.routes.js            # Mockup render/render-batch
│   │   ├── mockup-template.routes.js   # Şablon yönetimi + PSD + AI shadow
│   │   ├── notification.routes.js      # Bildirim sistemi
│   │   ├── pipeline.routes.js          # One-click + async BullMQ pipeline
│   │   ├── product-pack.routes.js      # Ürün paketleri
│   │   ├── prompt.routes.js            # Prompt sentezi + varyasyonlar
│   │   ├── radar.routes.js             # Rakip mağaza tarama
│   │   ├── scout.routes.js             # Google Trends + Pinterest → Claude mikro-niş öneri
│   │   ├── seo.routes.js               # Etsy SEO üretimi
│   │   ├── seo-knowledge.routes.js     # SEO bilgi tabanı yönetimi
│   │   ├── settings.routes.js          # Workspace yapılandırma
│   │   ├── style.routes.js             # Style Profile CRUD
│   │   ├── task.routes.js              # Günlük görev takibi (DailyTask)
│   │   ├── tool.routes.js              # BG kaldır / upscale / vektörize
│   │   ├── trends.routes.js            # Haftalık trend + sezonluk takvim
│   │   ├── vision.routes.js            # Tek dosya vision analizi
│   │   └── wpi.routes.js               # Winning Product Intelligence (Apify + Claude)
│   │
│   ├── services/                       # 44 servis dosyası — iş mantığı
│   │   ├── providers/
│   │   │   ├── fal.provider.js         # FAL.ai API istemcisi
│   │   │   ├── google-genai.provider.js # Google Generative AI istemcisi
│   │   │   └── image-router.js         # Model routing logic
│   │   ├── agent.service.js            # Otonom ajan aksiyonları
│   │   ├── ai-brain.service.js         # AI Brain üst servis
│   │   ├── analytics.service.js        # Kullanım istatistikleri
│   │   ├── apify.service.js            # Apify scraping (Etsy ürünleri, Pinterest)
│   │   ├── autonomous-manager.service.js # Gemini mağaza denetimi
│   │   ├── batch-factory.service.js    # Toplu üretim iş kuyruğu işleyici
│   │   ├── billing.service.js          # Stripe entegrasyonu (mock fallback)
│   │   ├── brain.service.js            # Brain veri erişim katmanı
│   │   ├── brainstorm.service.js       # Yaratıcı beyin fırtınası
│   │   ├── competitor-radar.service.js # Playwright rakip scraper
│   │   ├── etsy.service.js             # Etsy API yardımcıları
│   │   ├── etsy-browser.service.js     # Playwright: launchBrowser, createEtsyDraft, scrapeListings, pinToPinterest, updateListing
│   │   ├── etsy-mode.service.js        # keyword → niche → style → üretim
│   │   ├── finance.service.js          # Finansal işlem kayıt ve özet
│   │   ├── fulfillment.service.js      # Yuppion fabrika siparişleri
│   │   ├── generation.service.js       # FAL.ai görsel üretim + exponential backoff
│   │   ├── hq.service.js               # HQ dashboard hesaplamaları
│   │   ├── image.service.js            # Görsel DB işlemleri
│   │   ├── keyword-research.service.js # Etsy autocomplete anahtar kelime genişletme
│   │   ├── knowledge.service.js        # Bilgi dosyası işleme (PDF, video, text)
│   │   ├── knowledge-context.service.js # Merkezi context sağlayıcı — tüm AI çağrılarına enjekte
│   │   ├── listing-assembler.service.js # SEO + mockup → etsy-browser dispatcher
│   │   ├── log.service.js              # JobLog tablo logu
│   │   ├── market.service.js           # Piyasa zekâsı verileri
│   │   ├── mockup.service.js           # Mockup veri erişim katmanı
│   │   ├── mockup-render.service.js    # Sharp compositing motoru (PSD tint dahil)
│   │   ├── multimodal-brain.service.js # ffmpeg + Whisper + Claude Vision → CorporateMemory
│   │   ├── playwright-monitor.service.js # Playwright oturum sağlık izleme
│   │   ├── product-pack.service.js     # Çok ürünlü paket yönetimi
│   │   ├── prompt.service.js           # Prompt şablonları ve sentezi
│   │   ├── psd-analyzer.service.js     # psd.js → smart object bounds, shadow layer, gray_base.png
│   │   ├── risk.service.js             # Trademark / yasaklı kelime denetimi
│   │   ├── safety.service.js           # İçerik güvenlik kontrolü
│   │   ├── scout.service.js            # Google Trends + Pinterest → 5 mikro-niş öneri
│   │   ├── secrets.service.js          # API key çözümü: DB → env → throw
│   │   ├── seo.service.js              # Etsy SEO içerik üretimi
│   │   ├── seo-knowledge.service.js    # SEO KB yönetimi
│   │   ├── storage.service.js          # Yerel dosya yükleme + URL çözümü (assets/uploads/)
│   │   ├── style.service.js            # StyleProfile CRUD
│   │   ├── style-manager.service.js    # Stil preset yönetimi
│   │   ├── task.service.js             # DailyTask CRUD
│   │   ├── variation.service.js        # Renk / stil varyasyon üretimi
│   │   ├── vision.service.js           # Çok sağlayıcılı görsel analiz fallback zinciri
│   │   ├── wpi.service.js              # Winning Product Intelligence — Apify + Claude analiz
│   │   └── youtube.service.js          # YouTube içerik ingestion
│   │
│   ├── queues/
│   │   ├── index.js                    # BullMQ kuyruk kurulumu (asset, batch-setup, knowledge-ingestion)
│   │   └── asset.worker.js             # Arka plan asset işleme işleyici
│   │
│   ├── jobs/
│   │   └── seo-knowledge-updater.js    # Haftalık SEO cron
│   │
│   └── config/
│       ├── workspace.middleware.js     # Oturum cookie'sinden workspaceId çıkar
│       └── redis.js                   # Redis bağlantı yapılandırması
│
├── frontend/
│   ├── app/
│   │   ├── dashboard/
│   │   │   ├── overview/               # Genel bakış
│   │   │   ├── factory/                # Ana üretim pipeline
│   │   │   ├── gallery/                # Görsel galeri
│   │   │   ├── mockups/                # Şablon editörü + render
│   │   │   ├── tools/                  # BG kaldır / upscale / vektör (sekme tabanlı)
│   │   │   ├── remove-bg/              # Eski ayrı BG kaldır sayfası (backward compat)
│   │   │   ├── upscale/                # Eski ayrı upscale sayfası
│   │   │   ├── vector/                 # Eski ayrı vektör sayfası
│   │   │   ├── seo/                    # Etsy SEO üretici
│   │   │   ├── etsy-mode/              # keyword → niche → üretim
│   │   │   ├── etsy-listings/          # Etsy ilan scrape + SEO optimize
│   │   │   ├── ideas/                  # Toplu fikir üretimi
│   │   │   ├── packs/                  # Ürün paket şablonları
│   │   │   ├── orders/                 # Fulfillment siparişleri (mock)
│   │   │   ├── billing/                # Stripe abonelik planları
│   │   │   ├── settings/               # Workspace config + API key yönetimi
│   │   │   ├── analytics/              # CSV import + performans tablosu
│   │   │   ├── exports/                # ZIP/CSV dışa aktarma
│   │   │   ├── radar/                  # Rakip mağaza tarama
│   │   │   ├── trends/                 # Haftalık trendler + sezonluk takvim
│   │   │   ├── agent/                  # Otonom mağaza denetimi
│   │   │   ├── brain/                  # AI Brain — video/metin yükleme, bellek tarama
│   │   │   ├── hq/                     # HQ dashboard — günlük görevler, legal guard, finansal hedefler
│   │   │   └── wpi/                    # Winning Product Intelligence — niş analiz
│   │   ├── login/                      # Auth sayfası
│   │   ├── globals.css                 # Tasarım token'ları + CSS değişkenleri + dark/light mod
│   │   └── layout.tsx                  # Kök layout
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx             # 220px sabit nav (tüm sayfa linkleri, kısayollar, tema toggle)
│   │   │   └── Topbar.tsx              # Bildirim zili + workspace bilgisi
│   │   ├── shared/
│   │   │   ├── StatusBadge.tsx
│   │   │   ├── StatCard.tsx
│   │   │   ├── FileDropzone.tsx
│   │   │   └── ConfirmModal.tsx
│   │   └── ShortcutsInit.tsx           # Global klavye kısayolları (Ctrl+Shift+F/G/S/M)
│   ├── hooks/
│   │   └── useKeyboardShortcuts.ts
│   └── lib/
│       ├── api.ts                      # Tüm API istemci fonksiyonları
│       └── utils.ts                    # cn(), truncateId(), getStatusColor()
│
├── prisma/
│   └── schema.prisma                   # 21 model
│
├── assets/
│   ├── mockups/                        # Şablon görselleri (/assets/mockups, CORS açık)
│   ├── outputs/                        # Render edilmiş mockuplar (/assets/outputs, workspace kapsamlı)
│   └── presets/
│       └── shadows/                    # 6 kategori için preset shadow PNG'leri
│
├── scripts/
│   └── create-preset-shadows.js       # Sharp+SVG tabanlı preset shadow üretici
│
├── uploads/
│   ├── temp/                           # Multer geçici dosyaları
│   └── raw/                            # Ham bilgi dosyaları (PDF, video — 1GB limit)
│
├── TASKS.md                            # Görev panosu + bilinen hatalar
├── CLAUDE.md                           # Bu dosya
└── .env                                # Environment değişkenleri
```

---

## Tüm API Route'ları

### Özel endpoint'ler (src/index.js içinde inline)

| Metod | Path | Açıklama |
|-------|------|----------|
| GET | `/health` | Canlılık kontrolü |
| GET | `/api/status` | FAL sağlık (30s cache) + günlük/aylık harcama + bütçe limiti |
| GET | `/api/dashboard` | Genel istatistikler: çalışmalar, görseller, harcama, haftalık grafik, en çok onaylananlar |

### Auth (`src/routes/auth.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| POST | `/api/auth/login` | Email + şifre ile giriş, oturum cookie'si ayarlar |
| POST | `/api/auth/logout` | Oturum cookie'sini temizler |
| GET | `/api/auth/me` | Mevcut kullanıcı bilgisi |

### Settings (`src/routes/settings.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| GET | `/api/settings` | Workspace yapılandırması |
| POST | `/api/settings/keys` | Sağlayıcı API anahtarı ayarla |
| DELETE | `/api/settings/keys/:provider` | Sağlayıcı API anahtarını sil |

### Vision (`src/routes/vision.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| POST | `/api/vision/analyze` | Görsel dosya analizi (multipart) — yapılandırılmış tasarım verisi döner |

### Prompt (`src/routes/prompt.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| POST | `/api/prompt/synthesize` | Vision verisinden prompt üret |
| POST | `/api/prompt/variations` | Prompt varyasyonları üret |

### Generation (`src/routes/generation.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| POST | `/api/generate/run` | Görsel üret (Flux/Ideogram/Recraft/Schnell via FAL) |

### Factory (`src/routes/factory.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| GET | `/api/factory/models` | Desteklenen model listesi |
| POST | `/api/factory/analyze` | Vision analiz (çok sağlayıcı fallback) |
| POST | `/api/factory/get-variations` | Bilgi context'li prompt varyasyonları |
| POST | `/api/factory/generate` | Tam üretim adımı |
| POST | `/api/factory/retry/:jobId` | Başarısız işi yeniden dene |
| POST | `/api/factory/etsy-mode` | keyword → niche → style → üretim |

### Gallery (`src/routes/gallery.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| GET | `/api/gallery/recent` | Tüm işlerdeki son 100 görsel |
| GET | `/api/gallery/:jobId` | Belirli bir işin görselleri |
| POST | `/api/gallery/save-mockup` | Mockup sonucunu onaylanmış galeriye kaydet |
| POST | `/api/gallery/:imageId/approve` | Görseli onayla |
| POST | `/api/gallery/:imageId/reject` | Görseli reddet |
| POST | `/api/gallery/:imageId/regenerate` | Aynı prompttan yeniden üret |
| DELETE | `/api/gallery/:imageId` | Görseli sil (workspace kapsamlı auth) |

### Jobs (`src/routes/jobs.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| GET | `/api/jobs` | Workspace için iş geçmişi listesi |

### Tools (`src/routes/tool.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| POST | `/api/tools/remove-bg` | Arka plan kaldırma (BiRefNet/Bria/Pixelcut) |
| POST | `/api/tools/upscale` | Görsel ölçekleme (ESRGAN/AuraSR/Ideogram, 1x–8x) |
| POST | `/api/tools/vectorize` | Vektör dönüşümü (fal-ai/recraft-v3) |

### Pipeline (`src/routes/pipeline.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| POST | `/api/pipeline/run` | Tek görseli BullMQ'ya ekle (async) |
| POST | `/api/pipeline/run-job/:jobId` | Tüm onaylı görselleri ekle (idempotent, async) |
| GET | `/api/pipeline/status/:jobId` | Pipeline ilerleme durumu |
| POST | `/api/pipeline/one-click` | BG Kaldır → Mockup → SEO eşzamanlı tek istek |

**one-click body:** `{ imageId, imageUrl, templateIds[], bgModel: 'birefnet'|'bria'|'pixelcut', options: { bgRemove, seo } }`

### SEO (`src/routes/seo.routes.js` + `seo-knowledge.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| POST | `/api/seo/generate` | Etsy SEO üret (başlık/açıklama/13 etiket) |
| GET | `/api/seo-knowledge` | Workspace için aktif bilgi tabanı |
| POST | `/api/seo-knowledge/auto-update` | Claude destekli KB yenileme |
| POST | `/api/seo-knowledge/manual` | Manuel içerik geçersiz kılma |
| POST | `/api/seo-knowledge/activate/:id` | Belirli versiyonu etkinleştir |

### Mockup Şablonları (`src/routes/mockup-template.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| POST | `/api/mockups/templates` | Şablon yükle (base + mask + shadow + dark varyant; PSD destekli) |
| GET | `/api/mockups/templates` | Workspace için tüm şablonlar |
| GET | `/api/mockups/templates/presets` | Dahili preset şablonlar |
| GET | `/api/mockups/templates/:id` | Tekil şablon |
| PATCH | `/api/mockups/templates/:id` | Şablon konfigürasyonunu güncelle |
| DELETE | `/api/mockups/templates/:id` | Şablon sil |
| POST | `/api/mockups/templates/detect-print-area` | AI baskı alanı tespiti |
| POST | `/api/mockups/templates/bulk-upload` | Çoklu şablon yükle (100 dosya, 20'li batch) |
| POST | `/api/mockups/templates/render-video` | Animasyonlu video mockup (kling-video) |
| POST | `/api/mockups/templates/:id/generate-shadow` | AI gölge üret (FAL.ai depth model → invert+blur → shadow_ai.png) |

### Mockup Render (`src/routes/mockup.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| POST | `/api/mockups/render` | Sharp compositing (şablon + tasarım → çıktı) |
| POST | `/api/mockups/render-batch` | Aynı tasarımı birden fazla şablonda render et |

### Ideas (`src/routes/idea.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| POST | `/api/ideas/generate` | niche/keyword/persona'dan fikir üret |
| GET | `/api/ideas` | Workspace fikir listesi |
| POST | `/api/ideas/:id/status` | Fikir durumunu güncelle |
| POST | `/api/ideas/:id/factory` | Fikri factory'ye gönder |
| POST | `/api/ideas/generate-bulk` | Claude Haiku + brain context ile toplu üretim |

### Analitik ve Dışa Aktarma

| Metod | Path | Açıklama |
|-------|------|----------|
| POST | `/api/analytics/import` | CSV import → ProductPerformance upsert |
| GET | `/api/analytics/performance` | Performans tablosu verisi |
| POST | `/api/export/etsy` | Etsy formatlı CSV dışa aktarma |
| GET | `/api/export/job/:jobId/bundle` | İşin görsellerini ZIP bundle |

### Product Packs (`src/routes/product-pack.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| GET | `/api/packs/products` | Mevcut ürün tipleri |
| GET | `/api/packs` | Workspace paket listesi |
| POST | `/api/packs` | Paket oluştur |
| POST | `/api/packs/:packId/run` | Paket üretimini çalıştır |
| DELETE | `/api/packs/:packId` | Paket sil |

### AI Brain (`src/routes/brain.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| GET | `/api/brain` | Tüm kurumsal bellek girişleri |
| GET | `/api/brain/knowledge` | Gruplandırılmış bilgi (video/metin/auto) |
| GET | `/api/brain/summary` | Giriş sayısı + son güncelleme tarihi |
| POST | `/api/brain/ingest-video` | Gemini Vision ingestion (eski) |
| POST | `/api/brain/analyze-video` | Claude Vision + Whisper transkripsiyon |
| POST | `/api/brain/add-text` | Makale/metin ingestion |
| POST | `/api/brain/test-knowledge` | RAG sorgusu |
| DELETE | `/api/brain/:id` | Bellek girişi sil |

### Knowledge (`src/routes/knowledge.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| POST | `/api/knowledge/upload` | Büyük dosya yükle (PDF, video — 1GB limit, async BullMQ) |

### Otonom Ajan (`src/routes/agent.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| POST | `/api/agent/audit` | Mağaza denetimi → AI aksiyon planı (Gemini) |
| POST | `/api/agent/execute-action` | UPDATE_PRICE veya UPDATE_SEO Playwright ile çalıştır |

### Etsy Browser (`src/routes/etsy-browser.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| POST | `/api/etsy-browser/create-draft` | Playwright ile Etsy ilan formu doldur |
| POST | `/api/etsy-browser/dispatch` | SEO+mockup birleştir → create-draft |
| POST | `/api/etsy-browser/scrape` | Satıcı dashboard ilanlarını scrape et |
| POST | `/api/etsy-browser/pin-pinterest` | Tasarımı Pinterest'e otomatik sabitle |

### Radar & Trends

| Metod | Path | Açıklama |
|-------|------|----------|
| POST | `/api/radar/scan` | Rakip Etsy mağazalarını scrape et |
| GET | `/api/trends/weekly` | Haftalık anahtar kelime trendleri + Claude analiz |
| GET | `/api/trends/seasonal` | Tam yıllık sezonluk takvim |

### Apify (`src/routes/apify.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| POST | `/api/apify/etsy-products` | Keyword ile Etsy ürün verisi scrape et |
| POST | `/api/apify/pinterest-trends` | Pinterest trend verileri (save=true → CorporateMemory'ye kaydet) |

### WPI — Winning Product Intelligence (`src/routes/wpi.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| POST | `/api/wpi/scan` | Apify + Claude → niş analiz raporu (72h Redis cache) |
| GET | `/api/wpi/scan/:scanId` | Tarama ilerlemesi / sonucu |
| POST | `/api/wpi/generate-seo` | WPI verisiyle SEO üret |

### Scout (`src/routes/scout.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| POST | `/api/scout/suggest` | Google Trends + Pinterest → Claude Haiku → 5 mikro-niş öner |
| GET | `/api/scout/suggestions` | Kayıtlı Scout önerilerini listele |

### HQ Dashboard (`src/routes/hq.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| GET | `/api/hq/stats` | Günlük görev ilerlemesi + finansal hedef + yasal ihlal taraması |

### Finansal İstihbarat (`src/routes/finance.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| GET | `/api/finance/summary` | Gelir/gider özeti |
| POST | `/api/finance/income` | Manuel Etsy satış kaydı |

### Batch Factory (`src/routes/batch.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| POST | `/api/batch/generate` | Niche → toplu tasarım üretimi (BullMQ async, 20 maks görsel) |
| GET | `/api/batch/:jobId/status` | Toplu iş durumu |

### Style Profiles (`src/routes/style.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| GET | `/api/styles` | Workspace stil profilleri listesi |
| POST | `/api/styles` | Yeni StyleProfile oluştur |
| GET | `/api/styles/:id` | Tekil stil profili |
| PATCH | `/api/styles/:id` | Stil profilini güncelle |
| DELETE | `/api/styles/:id` | Stil profili sil |
| POST | `/api/styles/:id/set-default` | Varsayılan profil yap |
| POST | `/api/styles/from-dna` | Kilitli seed/DNA'dan yeni profil oluştur |

### Görev Takibi (`src/routes/task.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| GET | `/api/tasks/today` | Bugünün DailyTask kayıtları |
| POST | `/api/tasks/initialize` | Günlük görevleri manuel başlat (test için) |

### Fulfillment (`src/routes/fulfillment.routes.js`)

| Metod | Path | Açıklama |
|-------|------|----------|
| GET | `/api/fulfillment/orders` | Sipariş listesi (Yuppion API gelinceye kadar mock) |
| POST | `/api/fulfillment/create` | Yuppion fabrikasına sipariş gönder (mock) |

### Diğer

| Metod | Path | Açıklama |
|-------|------|----------|
| POST | `/api/notifications/log` | Bildirim logla |
| GET | `/api/notifications` | Son 20 bildirim |
| POST | `/api/notifications/read-all` | Tümünü okundu işaretle |

> **Not:** `/api/billing` route'u `src/index.js`'de comment'le devre dışı bırakılmış.

---

## Tüm Frontend Sayfaları

| Path | Client Bileşeni | Açıklama |
|------|-----------------|----------|
| `/dashboard/overview` | OverviewClient.tsx | İstatistikler, harcama, haftalık grafik, en çok onaylananlar, hızlı aksiyonlar |
| `/dashboard/factory` | FactoryClient.tsx | Ana pipeline: yükle → vision → prompt → üret. Geçmiş dropdown, "Mockup'a"/"BG Kaldır'a" butonları |
| `/dashboard/gallery` | GalleryClient.tsx | Görsel geçmişi, onayla/reddet, toplu işlemler, BG model seçicili one-click pipeline modal |
| `/dashboard/mockups` | MockupsClient.tsx | Şablon seçici + Konva yerleştirme editörü + toplu render. Dark/light toggle, galeriye kaydet, Pinterest'e sabitle. PSD şablon renk picker (8 preset). AI gölge buton. |
| `/dashboard/tools` | ToolsClient.tsx | 3 sekme: BG Kaldır (5 görsel), Upscale (1x–8x), Vektör (Recraft v3). Sekme `?tab=` URL param'ı ile persist |
| `/dashboard/remove-bg` | RemoveBgClient.tsx | Eski BG kaldır sayfası (backward compat) |
| `/dashboard/upscale` | UpscaleClient.tsx | Eski upscale sayfası |
| `/dashboard/vector` | VectorClient.tsx | PNG → SVG vektör dönüşümü |
| `/dashboard/seo` | SeoClient.tsx | Etsy SEO üreticisi, checklist, kopya yardımcısı, "Etsy'de Yayımla" butonu |
| `/dashboard/etsy-mode` | EtsyModeClient.tsx | Keyword → niche → style → üretim akışı |
| `/dashboard/etsy-listings` | EtsyListingsClient.tsx | Mağaza ilanlarını scrape et, ilan başına SEO optimize et (öncesi/sonrası) |
| `/dashboard/ideas` | IdeasClient.tsx | Toplu fikir üretimi, trend niş çipleri, sırala, toplu factory'ye gönder |
| `/dashboard/packs` | PacksClient.tsx | Ürün paket şablonları |
| `/dashboard/orders` | OrdersClient.tsx | Fulfillment siparişleri (mock — Yuppion API bekliyor) |
| `/dashboard/billing` | BillingClient.tsx | Abonelik planları + Stripe checkout |
| `/dashboard/settings` | SettingsClient.tsx | Workspace config, sağlayıcı API key yönetimi, günlük harcama limiti |
| `/dashboard/analytics` | AnalyticsClient.tsx | CSV import, performans tablosu, en iyi ilan, onay başına maliyet, haftalık karşılaştırma |
| `/dashboard/exports` | ExportsClient.tsx | Tarih aralığı filtresi, durum filtresi, sadece-mockup toggle, ZIP/CSV indir |
| `/dashboard/radar` | RadarClient.tsx | Rakip mağaza scraping + trend tasarım analizi |
| `/dashboard/trends` | TrendsClient.tsx | Haftalık sıcak nişler + sezonluk takvim, Tasarım Üret / SEO Üret aksiyonları |
| `/dashboard/agent` | AgentClient.tsx | Otonom mağaza denetimi + fiyat/SEO aksiyon çalıştırma |
| `/dashboard/brain` | BrainClient.tsx | Video/metin yükle, bellek tara, bilgi test et (3 sekme) |
| `/dashboard/hq` | HqClient.tsx | HQ dashboard — günlük görev ilerlemesi (MOCKUP/SEO/ETSY_DRAFT), finansal hedef tahmini, yasal ihlal taraması |
| `/dashboard/wpi` | WpiClient.tsx | Winning Product Intelligence — niş giriş, Apify + Claude kapsamlı ürün analizi, SEO üretimi |

---

## Tüm Servisler

| Dosya | Ne Yapar |
|-------|----------|
| `vision.service.js` | Çok sağlayıcılı görsel analiz: Anthropic Claude → Gemini → OpenAI fallback zinciri |
| `generation.service.js` | FAL.ai görsel üretim, exponential backoff ile yeniden deneme, günlük cap uygulama |
| `variation.service.js` | Temel prompttan renk/stil varyasyon üretimi |
| `prompt.service.js` | Prompt sentezi ve şablon yönetimi |
| `mockup-render.service.js` | Sharp compositing motoru: base yükle → tasarımı yeniden boyutlandır → composite → dışa aktar. Çoklu baskı alanı (printAreas dizisi) desteği. `productColor` parametresi ile PSD gray_base → Sharp `.tint()` → renk değiştirme |
| `psd-analyzer.service.js` | psd.js v3.4.0: smart object bounds (`node.coords`), shadow katmanı extraction, greyscale base PNG üretimi |
| `storage.service.js` | Yerel dosya yükleme + URL çözümü — `assets/uploads/` dizinine kopyalar/indirir |
| `seo-knowledge.service.js` | SEO KB yönetimi: Claude ile otomatik üretim, manuel geçersiz kılma, getKnowledge() |
| `seo.service.js` | Etsy SEO içerik üretimi (başlık ≤140, açıklama, 13 etiket) |
| `knowledge-context.service.js` | **Merkezi context sağlayıcı** — brain belleği + SEO KB getirir ve AI çağrılarına enjekte eder. Fonksiyonlar: getSeoContext(), getFactoryContext(), getIdeasContext(), getRelevantContext(topic), getKnowledgeSummary() |
| `etsy-browser.service.js` | Playwright otomasyonu: launchBrowser(), createEtsyDraft(), scrapeListings(), pinToPinterest(), updateListing() |
| `playwright-monitor.service.js` | Playwright oturum sağlığı izleme ve yeniden başlatma |
| `etsy-mode.service.js` | Etsy-özel akış: keyword → niche → style → üretim |
| `listing-assembler.service.js` | SEO + mockup görsellerini birleştirir → etsy-browser'a dispatch eder |
| `competitor-radar.service.js` | Playwright rakip scraper: [data-listing-id] seçiciler, page.close() oturum koruması |
| `multimodal-brain.service.js` | Kurumsal bellek: ffmpeg kare extraction + Whisper transkripsiyon + Claude Vision kare başına + sentez. addTextKnowledge(), extractSeoKnowledge() SEO içgörülerini otomatik birleştirir |
| `autonomous-manager.service.js` | Gemini ile mağaza denetimi: runDailyAudit() aksiyon planı döner |
| `fulfillment.service.js` | Yuppion fabrika siparişleri: createOrder() (API key yoksa mock), syncEtsyOrders() (hardcoded mock) |
| `keyword-research.service.js` | Etsy autocomplete → gerçek arama önerileri, expandKeywords() |
| `product-pack.service.js` | Çok ürünlü paket yönetimi |
| `risk.service.js` | Üretilen içerik için trademark/yasaklı kelime kontrolü |
| `safety.service.js` | İçerik güvenlik politikası denetimi |
| `analytics.service.js` | Kullanım istatistikleri + ProductPerformance raporlaması |
| `billing.service.js` | Stripe entegrasyonu: checkout, webhook, müşteri portalı. Stripe yapılandırılmamışsa mock URL'lere düşer |
| `log.service.js` | JobLog tablosuna iş olay logu |
| `secrets.service.js` | API key çözümü: WorkspaceApiKey DB → process.env → throw |
| `wpi.service.js` | Apify Etsy scrape + Claude derinlemesine niş analizi. Redis'te 72h cache |
| `apify.service.js` | Apify API istemcisi: scrapeEtsyProducts(), Pinterest trends. X402/ödeme hatalarında otomatik fallback |
| `scout.service.js` | Google Trends + Pinterest veri → Claude Haiku → 5 mikro-niş öneri |
| `finance.service.js` | Gelir/gider kayıt + özet hesaplama (FinancialTransaction modeli) |
| `hq.service.js` | HQ dashboard: günlük görev takibi, finansal hedef tahmini, FLAGGED görsel taraması |
| `batch-factory.service.js` | Toplu üretim kuyruğu: niche → Claude prompt üretim → FAL.ai → çoklu görsel |
| `style.service.js` | StyleProfile CRUD işlemleri |
| `style-manager.service.js` | Stil preset yönetimi ve listesi |
| `task.service.js` | DailyTask oluşturma, sorgulama, güncelleme |
| `knowledge.service.js` | Büyük dosya ingestion: PDF, video, metin (BullMQ knowledge-ingestion kuyruğu) |
| `brainstorm.service.js` | Yaratıcı fikir üretimi ve beyin fırtınası yardımcıları |
| `market.service.js` | Piyasa zekâsı veri toplama |
| `image.service.js` | Görsel DB işlemleri (CRUD yardımcıları) |
| `mockup.service.js` | Mockup veri erişim katmanı |
| `youtube.service.js` | YouTube içerik ingestion ve analizi |
| `providers/fal.provider.js` | FAL.ai istemcisi: Flux Dev/Schnell, Ideogram, Recraft, BiRefNet, Bria, ESRGAN, AuraSR |
| `providers/google-genai.provider.js` | Google Generative AI (Gemini) istemcisi |
| `providers/image-router.js` | Model seçim ve yönlendirme mantığı |

---

## Veritabanı Modelleri (21 Model)

| Model | Anahtar Alanlar | Amaç |
|-------|-----------------|------|
| `User` | email, passwordHash | Kimlik doğrulama |
| `Workspace` | name, slug, dailyImageCap, concurrentJobCap, planName, stripeCustomerId | Faturalamalı kiracı birimi |
| `WorkspaceMember` | userId, workspaceId, role | Kullanıcı ↔ workspace eşlemesi |
| `WorkspaceApiKey` | workspaceId, provider, keyValue | Workspace başına sağlayıcı key geçersiz kılmaları (MVP düz metin) |
| `DesignJob` | workspaceId, originalImage, status, mode, keyword, niche, style, packId | Üretim çalışması |
| `Image` | jobId, engine, imageUrl, status, isApproved, cost, performanceScore, winnerFlag, flagReason | Üretilen görsel |
| `Mockup` | imageId, templateId, mockupUrl | Render edilmiş mockup sonucu |
| `SEOData` | imageId (unique), title, description, tags[] | Görsel başına Etsy SEO |
| `VisionAnalysis` | imageId, jobId, parsedVisionJson | Vision analiz sonucu |
| `JobLog` | jobId, eventType, status, data | İş başına olay logu |
| `Idea` | workspaceId, niche, mainKeyword, persona, hook, styleEnum, marketScore, marketData | Toplu fikir + piyasa puanı |
| `ProductPerformance` | imageId (unique), impressions, visits, favorites, orders, score | Etsy metrikleri |
| `ProductPack` | workspaceId, name | Çok ürünlü paket |
| `ProductPackItem` | packId, productType, placementConfig | Paketteki tekil öğe |
| `SeoKnowledgeBase` | workspaceId, content, source, isActive | SEO bilgi tabanı (auto/manuel) |
| `MockupTemplate` | workspaceId, name, category, baseImagePath, maskImagePath, darkImagePath, shadowImagePath, configJson | Baskı alanı konfigürasyonlu şablon |
| `CorporateMemory` | workspaceId, type, sourceType, title, content, category, tags[], vectorEmbedding, isActive | Brain RAG girişleri |
| `ApiUsage` | workspaceId, provider, modelName, inputTokens, outputTokens, cost, metadata | API kullanım ve maliyet takibi |
| `DailyTask` | date, taskType, targetCount, currentCount, isCompleted | Günlük otomasyon hedefleri (MOCKUP/SEO/ETSY_DRAFT) |
| `StyleProfile` | workspaceId, name, baseModel, promptPrefix, promptSuffix, negativePrompt, colorPalette, isDefault | Marka kiti / stil profili |
| `FinancialTransaction` | workspaceId, type, amount, provider, description, imageId | Gelir/gider kayıtları (Etsy + AI harcamaları) |

**Enum'lar:**
- `JobStatus`: PENDING / PROCESSING / COMPLETED / FAILED / BUDGET_EXCEEDED
- `ImageStatus`: GENERATED / APPROVED / REJECTED / PROCESSED / FAILED / COMPLETED / FLAGGED / PENDING_APPROVAL

---

## Environment Değişkenleri

```env
# Veritabanı
DATABASE_URL=postgresql://...         # Prisma — kendi SSH sunucusu (100.96.119.102:5432)
DIRECT_URL=postgresql://...           # Prisma doğrudan bağlantı (migration'lar için)

# Sunucu
PORT=3001                             # index.js varsayılan 3000 — .env ile 3001'e zorla

# AI Sağlayıcıları
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_GEMINI_API_KEY=...             # GOOGLE_API_KEY olarak da kontrol edilir
FAL_API_KEY=...                       # Flux, Schnell, Ideogram, Recraft, BiRefNet, Bria, upscaler'lar
PIXELCUT_API_KEY=...

# Depolama
# Not: Supabase kullanılmıyor. Tüm storage yerel assets/ dizininde.

# Maliyet Kontrolü
DAILY_BUDGET_CAP=5.00                 # FAL günlük harcama üst limiti
FAL_COST_PER_IMAGE=0.003              # Görsel başına sabit oran (tüm modeller)

# Frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001

# Scraping
APIFY_API_TOKEN=...                   # Etsy ürün scraping + Pinterest trendleri (WPI/Scout için)

# Faturalama (isteğe bağlı — ayarlanmamışsa mock URL'lere düşer)
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_UNLIMITED=price_...

# Fulfillment (Yuppion API'den önce mock)
YUPPION_API_KEY=...
DEFAULT_LISTING_PRICE=19.99

# Etsy (API onayı bekliyor)
ETSY_API_KEY=...
ETSY_API_SECRET=...
ETSY_REDIRECT_URI=...

# Tarayıcı Otomasyonu (Playwright)
BROWSER_USER_DATA=...                 # Kalıcı Chrome profil yolu (Etsy oturumunu korur)
BROWSER_EXE=...                       # Chrome çalıştırılabilir dosya yolu

# CORS (index.js'de düzeltildi — env'den okunuyor)
CORS_ORIGIN=http://localhost:3000
```

---

## Temel İş Akışları

### 1. Tam Tasarım Pipeline (Factory Sayfası)
```
Kullanıcı referans görsel yükler
  → POST /api/factory/analyze (vision: Anthropic/Gemini/OpenAI)
  → POST /api/factory/get-variations (promptlar + knowledge-context.service.js enjeksiyonu)
  → POST /api/factory/generate (FAL.ai: Flux/Ideogram/Recraft)
  → Görsel DB'ye kaydedilir (DesignJob + Image kayıtları)
  → Galeri sayfası: onayla → pipeline
```

### 2. One-Click Pipeline (Galeri Sayfası → ⚡ butonu)
```
PipelineModal açılır:
  - BG model seçici (BiRefNet/Bria/Pixelcut)
  - Şablon ızgarası (en fazla 5 seçili)
  - Adım toggle'ları (BG Kaldır, SEO)

POST /api/pipeline/one-click eşzamanlı çalışır:
  Adım 1: fal.subscribe(selectedBgModel, { image_url })
          → "processed" DesignJob olarak kaydeder
  Adım 2: renderMockup(şablon, bgRemovedImageId) × N şablon
          → "mockup_gallery" DesignJob olarak kaydeder
  Adım 3: vision → expandKeywords → Claude Haiku SEO
          → yanıtta başlık/açıklama/etiketler döner
```

### 3. Etsy Taslak Yayımlama (Mevcut — Playwright)
```
SEO sayfası → "Etsy'de Yayımla" butonu
  → POST /api/etsy-browser/create-draft
  → Playwright etsy.com/sell/listings/new açar
  → Başlık, açıklama, etiketler, fiyat doldurur, görselleri yükler
  → Taslak olarak kaydeder

VEYA Galeri dispatch yoluyla:
  → POST /api/etsy-browser/dispatch
  → listing-assembler.service.js SEOData + mockup görsellerini getirir
  → createEtsyDraft() çağırır
```

### 4. Bilgi Brain Döngüsü
```
Kullanıcı Brain sayfasına video/metin yükler
  → multimodal-brain.service.js işler
  → category + tags ile CorporateMemory tablosuna kaydeder
  → extractSeoKnowledge() SEO içgörülerini SeoKnowledgeBase'e otomatik birleştirir

Her AI çağrısında (SEO, Factory, Ideas):
  → knowledge-context.service.js ilgili CorporateMemory girişlerini getirir
  → Aktif SeoKnowledgeBase ile birleştirir
  → Claude/Gemini çağrısına sistem prompt olarak enjekte eder
```

### 5. Mockup Render
```
Kullanıcı Mockups sayfasında şablon + tasarım seçer
  → POST /api/mockups/render
  → mockup-render.service.js:
      1. Temel şablonu yükle (Sharp)
      2. Tasarım görselini getir
      3. printArea yerleşimini uygula (normalize 0–1 koordinatlar)
      4. Blend mode ile composite et
      5. assets/outputs/ dizinine kaydet
  → Sonuç TemplateEditor'da gösterilir (indir + galeriye kaydet + Pinterest)
```

### 6. PSD Şablon Akışı
```
PSD dosyası yüklenir (BulkUploadModal veya tekil yükleme)
  → psd-analyzer.service.js: smart object bounds → printArea, shadow layer
  → gray_base.png üretilir (renk değiştirme için)
  → shadow yoksa assets/presets/shadows/{kategori}_shadow.png'ye fallback
  → MockupTemplate.configJson.meta.isPsdDerived = true
  → Render sırasında productColor parametresi gelirse:
      gray_base.png yükle → Sharp .tint(hex) → geçici dosya → base olarak kullan
```

### 7. WPI — Winning Product Intelligence
```
Kullanıcı WPI sayfasında niş/keyword girer
  → POST /api/wpi/scan
  → Apify Etsy ürün scraped (gerçek pazar verisi)
  → Claude niş analizi + karlılık puanı üretir
  → Sonuç Redis'e 72h TTL ile cache'lenir
  → GET /api/wpi/scan/:scanId ile ilerleme takibi
  → POST /api/wpi/generate-seo ile analiz verisiyle SEO üretimi
```

### 8. Toplu (Batch) Üretim
```
POST /api/batch/generate { niche, count, engine, style }
  → DesignJob hemen oluşturulur (PENDING)
  → Ağır iş batch-setup kuyruğuna gider (Claude prompt + FAL üretim)
  → Endpoint <100ms'de yanıt verir (proxy timeout yok)
  → GET /api/batch/:jobId/status ile ilerleme takibi
```

---

## Bilinen Hatalar ve Açık Konular

| # | Konum | Hata | Önem |
|---|-------|------|------|
| 1 | `src/index.js:45 bölgesi` | CORS origin hardcoded, .env değişkenine bağlanmış — production'a taşınırken `CORS_ORIGIN` env değişkenini doğru ayarla | **Deploy dikkat noktası** |
| 2 | `src/services/fulfillment.service.js:60` | `syncEtsyOrders()` workspace'den bağımsız 1 hardcoded mock sipariş döner | Minor (beklenen) |
| 3 | `src/services/billing.service.js:121,198` | Stripe yapılandırılmamışsa checkout + portal mock `localhost:3001` URL döner | Minor (yalnızca dev) |
| 4 | `src/routes/billing.routes.js` | Billing route `src/index.js`'de comment'le devre dışı — production'da etkinleştirilmesi gerekecek | Orta |

*Önceden belgelenen Bug #1 (listing-assembler prisma.sEOContent) — codebase'de düzeltildi.*
*Önceden belgelenen Bug #3 (avgGenerationTime null) — düzeltildi.*

---

## Geliştirme Kılavuzu

### Yeni Backend Route Ekleme
1. `src/routes/feature.routes.js` oluştur
2. `src/index.js`'de kaydet: `app.use('/api/feature', require('./routes/feature.routes'))`
3. **Her DB sorgusu `req.workspaceId` ile filtrelenmelidir** — çok kiracılı çalışma böyle işler
4. Mantık karmaşıksa `src/services/feature.service.js` oluştur

### Yeni Frontend Sayfası Ekleme
1. `frontend/app/dashboard/page-name/page.tsx` — ince server bileşeni:
   ```tsx
   import { PageNameClient } from './PageNameClient';
   export default function PageNamePage() { return <PageNameClient />; }
   ```
2. `frontend/app/dashboard/page-name/PageNameClient.tsx` — `'use client'`, tüm mantık burada
3. `frontend/components/layout/Sidebar.tsx`'e nav linki ekle
4. `frontend/lib/api.ts`'e API fonksiyonları ekle

### Veritabanı Değişiklikleri
```bash
# 1. prisma/schema.prisma'yı düzenle
# 2. Migration oluştur
npx prisma migrate dev --name descriptive_name
# 3. Client'i yeniden üret
npx prisma generate
# 4. Doğrula
npx prisma studio
```

### API Context Enjeksiyonu Ekleme
Tüm AI çağrıları `knowledge-context.service.js` üzerinden iş bilgisi enjekte etmelidir:
```js
const { getSeoContext } = require('../services/knowledge-context.service');
const knowledge = await getSeoContext(req.workspaceId);
// knowledge'ı Claude/Gemini çağrısına sistem prompt olarak ilet
```
Mevcut fonksiyonlar: `getSeoContext()`, `getFactoryContext()`, `getIdeasContext()`, `getRelevantContext(topic)`, `getKnowledgeSummary()`

### Tasarım Sistemi
- **Accent:** Electric Violet `#7c3aed` → `var(--accent)` token
- **Arka Plan:** `#08090a`, **Kartlar:** `bg-[#111827]` veya `bg-slate-800/40`
- **Birincil CTA:** `bg-gradient-to-r from-purple-600 to-blue-600`
- **Yazı Tipi:** Geist sans + Geist Mono (kod/loglar için)
- Token'lar `frontend/app/globals.css`'de — mevcut token'ları kullan, yeni renk icat etme
- Dark/light mod: `html.light` class geçersiz kılmaları globals.css'de

### Teknik Dikkat Noktaları
- **psd.js v3.4.0:** Layer bounds `node.coords` üzerinde (NOT `node.layer.coords`), pixel data `layer.image.toPng().data` (NOT `toBuffer()`)
- **FAL.ai'ya local path gönderilemez** → base64 `data:image/png;base64,...` formatı kullan
- **WPI taramaları Redis'te saklanır** (`wpi:scan:<scanId>` key, 72h TTL) — memory değil
- **Billing route comment'li** — `src/index.js`'de `// app.use('/api/billing', ...)` şeklinde
- **Image.seed alanı** tasarım görsel ID'sini saklamak için yeniden kullanılmıştır (mockup referansı için)
- **DesignJob.mode='mockup_gallery'** — render edilmiş mockupları galeriden ayırt etmek için

---

## Yeni AI Asistanlar İçin

### Sahip kim?
Anılcan — tamamen otomatik bir mağaza kuran Etsy POD girişimcisi. Node.js/Express, Next.js, Prisma geliştirici. Türkçe iletişim kurar. Hızlı iterasyon, kapsamlı özellikler tercih eder. Hedef: Etsy mağazasını minimum manuel çalışmayla yürütmek.

### İş hedefi nedir?
Otomatik Etsy POD mağazası: tasarla → üret → mockup → listele → sipariş al → fabrikaya gönder → takip et → öğren → tekrarla. Platform nihayetinde döngünün tamamını neredeyse sıfır insan müdahalesiyle çalıştırmalıdır.

### Bekleyen kritik entegrasyonlar
- **Etsy API:** Başvuruldu, henüz onaylanmadı. Mevcut geçici çözüm: Playwright tarayıcı otomasyonu ile Etsy formları doğrudan doldurulur — kırılgan, Etsy UI değişikliklerinde bozulur. Onay geldiğinde resmi OAuth + listeleme endpoint'leri inşa et.
- **Yuppion:** POD fabrika ortağı. İlk siparişte API erişimi verilecek. fulfillment.service.js yapı hazır — yalnızca gerçek API key + Etsy sipariş senkronizasyonu gerekiyor.

### Brain sistemi merkezi öneme sahip
`CorporateMemory` + `SeoKnowledgeBase` `knowledge-context.service.js` üzerinden TÜM AI çağrılarına beslenir. Yeni bir AI özelliği eklerken her zaman uygun context fonksiyonunu (`getSeoContext`, `getFactoryContext`, vb.) çağır ve sistem context'i olarak ilet. Platform bu sayede yüklenen videolardan, toplantı notlarından ve Etsy trend makalelerinden zamanla öğrenir.

### Pipeline mimarisi
- `one-click` = eşzamanlı, tamamlanana kadar bloke eder, tek görseller için iyi
- `pipeline/run` + `run-job` = BullMQ üzerinden async, toplu işleme için iyi
- `batch/generate` = async BullMQ, niche → çoklu görsel üretimi için

### Etsy listeleme akışı (Playwright vs API)
Şu an: Playwright, kalıcı Chrome oturumuyla (`BROWSER_USER_DATA` oturumu canlı tutar) Etsy listeleme formunu dolduruyor. Çalışıyor ama kırılgan — Etsy UI değişiklikleri sessizce kırıyor. Resmi API onaylandığında Playwright yolunu değiştir (scraping/araştırma için `etsy-browser.service.js`'i koru).
