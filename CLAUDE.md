# POD AI Factory — Claude Code Guide

## Project Overview
POD AI Factory, Print-on-Demand ürünleri için AI destekli bir içerik üretim platformudur.
Kullanıcılar referans görsel yükler, AI analiz eder, prompt üretir, görsel oluşturur (Flux/Ideogram/Recraft),
arka plan kaldırır, büyütür ve Etsy listesi için SEO içeriği üretir.

## Tech Stack
- **Backend:** Node.js + Express — `src/index.js` entry point
- **Frontend:** Next.js 14 (App Router) — `frontend/app/`
- **Database:** PostgreSQL + Prisma ORM — `prisma/schema.prisma`
- **AI Providers:** Anthropic Claude, Google Gemini, OpenAI (vision), Flux, Ideogram, Recraft, Schnell
- **Image Processing:** BiRefNet, Bria, Pixelcut (BG remove), ESRGAN, AuraSR (upscale)
- **Storage:** Supabase
- **Design System:** Electric Violet (#7c3aed), Geist font, #08090a background

## Project Structure
```
pod-ai-factory/
├── src/                    # Backend (Node.js/Express)
│   ├── index.js            # Ana sunucu, route kayıtları
│   ├── routes/             # API endpoint'leri
│   └── services/           # İş mantığı servisleri
├── frontend/               # Next.js frontend
│   ├── app/
│   │   ├── dashboard/      # Tüm sayfa bileşenleri
│   │   ├── globals.css     # Design tokens, renk sistemi
│   │   └── layout.tsx      # Root layout (220px sidebar)
│   ├── components/
│   │   ├── layout/         # Sidebar.tsx, Topbar.tsx
│   │   └── shared/         # StatusBadge.tsx, paylaşılan bileşenler
│   └── lib/
│       └── utils.ts        # getStatusColor ve yardımcı fonksiyonlar
├── prisma/
│   └── schema.prisma       # DB şeması
├── assets/
│   └── mockups/            # Mockup template görselleri
├── TASKS.md                # Aktif görev kuyruğu
└── walkthrough.md          # Son UI değişiklikleri

```

## Running the Project
```bash
# Proje kökünden her şeyi başlat
npm run dev

# Backend: http://localhost:3001 (veya .env'deki PORT)
# Frontend: http://localhost:3000
```

## Database
Prisma ORM ile PostgreSQL. Temel modeller:
- **Job** — Görsel üretim işleri (prompt, status, provider, results)
- **MockupTemplate** — Mockup şablonları (baseImage, maskImage, printArea, category)
- **SEOContent** — Etsy için üretilen başlık/açıklama/tag
- **Analytics** — Kullanım istatistikleri

DB değişikliği için:
```bash
npx prisma migrate dev --name degisiklik_adi
npx prisma generate
```

## API Routes (Backend — src/routes/)
| Route | Açıklama |
|-------|----------|
| `POST /api/jobs` | Yeni görsel üretim işi başlat |
| `GET /api/jobs` | İş geçmişini listele |
| `GET /api/jobs/:id` | Tek iş detayı |
| `POST /api/vision` | Referans görseli analiz et (multi-provider) |
| `POST /api/generate` | Görsel üret (Flux/Ideogram/Recraft/Schnell) |
| `POST /api/remove-bg` | Arka plan kaldır (BiRefNet/Bria/Pixelcut) |
| `POST /api/upscale` | Görseli büyüt (ESRGAN/AuraSR/Ideogram) |
| `POST /api/seo/generate` | Etsy SEO içeriği üret |
| `POST /api/seo/knowledge-base` | SEO bilgi tabanını güncelle |
| `GET /api/etsy/auth` | Etsy OAuth2 başlat (BEKLEMEDE) |
| `GET /api/etsy/callback` | Etsy OAuth2 callback (BEKLEMEDE) |
| `POST /api/etsy/listings` | Etsy listesi oluştur (BEKLEMEDE) |
| `POST /api/mockups/templates` | Mockup template yükle (EKSİK - TASK #1) |

## Frontend Pages (frontend/app/dashboard/)
| Sayfa | Açıklama |
|-------|----------|
| `factory/` | Ana üretim pipeline — vision analiz + prompt + görsel üretim |
| `gallery/` | Üretilen görseller — geçmiş, filtre, onay/red, tam ekran görüntü |
| `mockups/` | Mockup oluşturucu — template seçimi, design picker, render |
| `remove-bg/` | Arka plan kaldırma sayfası |
| `upscale/` | Görsel büyütme sayfası |
| `seo/` | Etsy SEO içerik üretici |
| `analytics/` | Analitik ve CSV import (GÖZDEN GEÇİRİLECEK - TASK #9) |
| `ideas/` | Fikir sayfası (GÖZDEN GEÇİRİLECEK - TASK #8) |

## Environment Variables
```env
# Backend
DATABASE_URL=postgresql://...
PORT=3001

# AI Providers
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_GEMINI_API_KEY=...
FAL_API_KEY=...           # Flux, Schnell, AuraSR, BiRefNet, Bria
IDEOGRAM_API_KEY=...
RECRAFT_API_KEY=...

# Image Services
PIXELCUT_API_KEY=...
ESRGAN_API_KEY=...        # veya kullanılan servis

# Storage
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Etsy (henüz aktif değil)
ETSY_API_KEY=...
ETSY_API_SECRET=...
ETSY_REDIRECT_URI=...
```

## Design System
- **Accent:** Electric Violet `#7c3aed`
- **Background:** `#08090a`
- **Font:** Geist (sistem), Geist Mono (log console)
- **Sidebar:** 220px genişlik, accent-colored active states, left border vurgu
- **Kartlar:** `#1a1a1a` bg, 12px border-radius
- **Status Badge:** Pill shape, 6px radius, 10px uppercase

## Development Workflow

### Her görev öncesi:
1. `TASKS.md` dosyasını kontrol et — hangi görev öncelikli?
2. Mevcut ilgili dosyaları oku, değişikliğin etkisini anla
3. Plan Modu ile başla, sonra Act Modu'na geç

### Backend değişikliği:
- Route: `src/routes/yeni-route.js` oluştur
- `src/index.js`'de route'u kaydet: `app.use('/api/...', require('./routes/...'))`
- Service: `src/services/yeni-service.js`

### Frontend değişikliği:
- Sayfa: `frontend/app/dashboard/sayfa-adi/page.tsx` (server component)
- Client: `frontend/app/dashboard/sayfa-adi/SayfaClient.tsx` (client component)
- Paylaşılan: `frontend/components/shared/`

### DB değişikliği:
```bash
# 1. prisma/schema.prisma'yı düzenle
# 2. Migration oluştur
npx prisma migrate dev --name degisiklik_adi
# 3. Client'ı yenile
npx prisma generate
```

### Stil değişikliği:
- Design token'lar: `frontend/app/globals.css`
- Mevcut token'ları kullan, yeni renk icat etme
- Accent: `var(--accent)` = `#7c3aed`

## Current Task Queue

### 🔴 HIGH PRIORITY

**TASK 1 — Mockup Template Upload Tool**
- Backend: `POST /api/mockups/templates` route'u kontrol et/oluştur
- Frontend: `frontend/app/dashboard/mockups/TemplateUploader.tsx`
  - PNG dropzone (base image + opsiyonel mask)
  - Kategori seçici: tshirt/sweatshirt/hoodie/mug/sticker/phone_case
  - Görsel print area seçici (sürükle-bırak rectangle, normalized 0-1)
  - MockupsClient.tsx'e entegre et

**TASK 2 — Mockup Design Picker Job History**
- Şu an: Manuel Job ID girişi gerekiyor
- Düzeltme: `GET /api/jobs` ile otomatik yükle, tıklanabilir liste göster

**TASK 3 — Download Button Fix**
- Şu an: "Open full size" yeni sekmede açıyor
- Düzeltme: Direkt download, dosya adı `mockup-{templateName}-{timestamp}.png`

### 🟡 MEDIUM PRIORITY

**TASK 4 — Etsy API Integration** (API onayı bekleniyor)
- OAuth2 flow, listing oluşturma
- Factory ve SEO sayfalarına "Publish to Etsy" butonu

**TASK 5 — Bulk Upload in Factory**
- Çoklu referans görsel yükleme
- Her görsel → ayrı AI analiz → ayrı prompt → kuyruğa ekle

**TASK 6 — Gallery All Jobs View**
- Tüm işlerdeki görselleri tek görünümde listele

### 🟢 LOW PRIORITY

**TASK 7 — Overview Dashboard**
- Eski iş thumbnail yükleme fix
- Haftalık/aylık istatistik grafikleri

**TASK 8 — Ideas Page** — Gözden geçir, düzelt

**TASK 9 — Analytics Page** — Gözden geçir, CSV import test et

## Completed Features ✅
- Multi-provider Vision (Anthropic/Gemini/OpenAI)
- Factory pipeline (AI Prompt + Variations)
- Multi-model generation (Flux, Ideogram, Recraft, Schnell)
- Style presets + prompt templates + negative prompt
- Factory results panel (BG remove + Upscale + SEO inline)
- Remove BG page (BiRefNet + Bria + Pixelcut)
- Upscale page (ESRGAN + Ideogram + AuraSR, 1x-8x)
- Gallery history + URL state persistence
- Supabase migration
- SEO Generator with Live Etsy Data
- SEO Knowledge Base (auto weekly update + manual override)
- Download buttons (direct download + descriptive filenames)
- Etsy 2026 algorithm training in system prompt
- UI Refresh: Electric Violet design system (8 dosya güncellendi)