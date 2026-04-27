# POD AI Factory — CLAUDE.md

## AI Assistant Rules (claude-doctor generated)

- **Read before editing.** Always read the full file before making any changes. Plan all edits first, then make ONE complete edit. If the same file has been edited 3+ times in a session, stop and re-read the original requirements.
- **Stay on target.** Every few turns, re-read the original request to confirm you haven't drifted from the goal.
- **Follow through completely.** Re-read the user's last message before responding. Execute every instruction fully — do not partially implement.
- **On correction: stop and confirm.** When the user corrects you, stop, re-read their message, quote back what they asked for, and confirm before proceeding.

---

## Project Overview

POD AI Factory is an AI-powered automation platform for running an Etsy Print-on-Demand business with minimum human touch. The owner (Anılcan) is setting up an Etsy POD store and wants end-to-end automation:

**Full pipeline goal:**
1. Upload or find a reference image/trend
2. AI analyzes it, generates design prompts
3. Multi-model image generation (Flux/Ideogram/Recraft)
4. Background removal + upscaling
5. Mockup rendering on product templates
6. Etsy SEO generation (title/description/13 tags)
7. Publish as Etsy draft listing (Playwright now, official API when approved)
8. Order comes in → automatically route to Yuppion POD factory
9. Track performance → feed insights back into AI Brain → improve next iteration

**Current state (April 2026):** Steps 1–7 are fully built. Steps 8–9 are mock/pending external API access.

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Backend | Node.js + Express 5 | `src/index.js`, port 3001 |
| Frontend | Next.js 14 App Router + React 19 | `frontend/`, port 3000 |
| Database | PostgreSQL + Prisma ORM 5.15 | 17 models |
| Job Queue | BullMQ + Redis | localhost:6379 |
| Storage | Supabase Storage + local `assets/` | bucket: mockup-outputs |
| Vision AI | Anthropic Claude (primary) → Google Gemini → OpenAI | Auto-fallback chain |
| Image Gen | FAL.ai — Flux Dev, Flux Schnell, Ideogram, Recraft | |
| BG Removal | BiRefNet (free), Bria Pro, Pixelcut | all via FAL.ai |
| Upscaling | ESRGAN, AuraSR, Ideogram | 1x–8x |
| Browser Automation | Playwright + Chromium | Etsy/Pinterest/scraping |
| UI Framework | Tailwind CSS v4, Radix UI, Lucide icons | |
| Canvas | Konva + react-konva | mockup placement editor |
| Charts | Recharts | weekly stats |
| Forms | React Hook Form + Zod | |
| State | TanStack React Query | all API calls |

---

## Running the Project

```bash
# Start everything (kills ports 3000+3001 first, then starts both)
npm run dev

# Individual
npm run dev:backend    # nodemon src/index.js (ignores assets/)
npm run dev:frontend   # next dev

# Production
npm start
```

- Backend: http://localhost:3001
- Frontend: http://localhost:3000
- Frontend calls backend via `NEXT_PUBLIC_API_BASE_URL` env var
- **Note:** `src/index.js` defaults PORT to 3000 but `.env` sets it to 3001. Always check `.env`.

---

## Project Structure

```
pod-ai-factory/
├── src/                          # Backend (Node.js/Express)
│   ├── index.js                  # Entry point: middleware, routes, special endpoints, server
│   ├── routes/                   # 27 route files — one per feature area
│   ├── services/                 # 22 service files — business logic
│   │   └── providers/
│   │       └── fal.provider.js   # FAL.ai API client
│   ├── queues/
│   │   ├── index.js              # BullMQ queue setup
│   │   └── asset.worker.js       # Background asset processing
│   ├── jobs/
│   │   └── seo-knowledge-updater.js  # Weekly SEO cron
│   └── config/
│       └── workspace.middleware.js   # Extracts workspaceId from session cookie
│
├── frontend/
│   ├── app/
│   │   ├── dashboard/            # 22 page directories
│   │   ├── login/                # Auth page
│   │   ├── globals.css           # Design tokens + CSS variables + dark/light mode
│   │   └── layout.tsx            # Root layout
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx       # 220px fixed nav (all page links, shortcuts, theme toggle)
│   │   │   └── Topbar.tsx        # Notification bell + workspace info
│   │   ├── shared/
│   │   │   ├── StatusBadge.tsx
│   │   │   ├── StatCard.tsx
│   │   │   ├── FileDropzone.tsx
│   │   │   └── ConfirmModal.tsx
│   │   └── ShortcutsInit.tsx     # Global keyboard shortcuts (Ctrl+Shift+F/G/S/M)
│   ├── hooks/
│   │   └── useKeyboardShortcuts.ts
│   └── lib/
│       ├── api.ts                # All API client functions (apiGallery, apiPipeline, etc.)
│       └── utils.ts              # cn(), truncateId(), getStatusColor()
│
├── prisma/
│   └── schema.prisma             # 17 models
│
├── assets/
│   ├── mockups/                  # Template images (served at /assets/mockups, CORS open)
│   └── outputs/                  # Rendered mockups (served at /assets/outputs, workspace-scoped)
│
├── TASKS.md                      # Current task board + known bugs
├── CLAUDE.md                     # This file
└── .env                          # Environment variables
```

---

## All API Routes

### Special endpoints (inline in src/index.js)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Alive check |
| GET | `/api/status` | FAL health (30s cache) + daily/monthly spend + budget cap |
| GET | `/api/dashboard` | Overview stats: runs, images, spend, weekly chart, top approved |

### Auth (`src/routes/auth.routes.js`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login with email+password, sets session cookie |
| POST | `/api/auth/logout` | Clear session cookie |
| GET | `/api/auth/me` | Current user info |

### Settings (`src/routes/settings.routes.js`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | Workspace config |
| POST | `/api/settings/keys` | Set provider API key |
| DELETE | `/api/settings/keys/:provider` | Remove provider API key |

### Vision (`src/routes/vision.routes.js`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/vision/analyze` | Analyze image file (multipart) — returns structured design data |

### Prompt (`src/routes/prompt.routes.js`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/prompt/synthesize` | Generate prompt from vision data |
| POST | `/api/prompt/variations` | Generate prompt variations |

### Generation (`src/routes/generation.routes.js`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/generate/run` | Generate image (Flux/Ideogram/Recraft/Schnell via FAL) |

### Factory (`src/routes/factory.routes.js`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/factory/models` | Supported model list |
| POST | `/api/factory/analyze` | Vision analyze (multi-provider fallback) |
| POST | `/api/factory/get-variations` | Prompt variations with knowledge context |
| POST | `/api/factory/generate` | Full generate step |
| POST | `/api/factory/retry/:jobId` | Retry failed job |
| POST | `/api/factory/etsy-mode` | Keyword → niche → style → generation |

### Gallery (`src/routes/gallery.routes.js`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/gallery/recent` | Latest 100 images across all jobs |
| GET | `/api/gallery/:jobId` | Images for a specific job |
| POST | `/api/gallery/save-mockup` | Save mockup result as approved gallery image |
| POST | `/api/gallery/:imageId/approve` | Approve image |
| POST | `/api/gallery/:imageId/reject` | Reject image |
| POST | `/api/gallery/:imageId/regenerate` | Regenerate from same prompt |
| DELETE | `/api/gallery/:imageId` | Delete image (workspace-scoped auth) |

### Jobs (`src/routes/jobs.routes.js`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/jobs` | Job history list for workspace |

### Tools (`src/routes/tool.routes.js`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/tools/remove-bg` | Background removal (BiRefNet/Bria/Pixelcut) |
| POST | `/api/tools/upscale` | Image upscaling (ESRGAN/AuraSR/Ideogram, 1x–8x) |
| POST | `/api/tools/vectorize` | Vector conversion via fal-ai/recraft-v3 |

### Pipeline (`src/routes/pipeline.routes.js`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/pipeline/run` | Enqueue single image to BullMQ (async) |
| POST | `/api/pipeline/run-job/:jobId` | Enqueue all approved images (idempotent, async) |
| GET | `/api/pipeline/status/:jobId` | Pipeline progress |
| POST | `/api/pipeline/one-click` | BG Remove → Mockup → SEO synchronously in one request |

**one-click body:** `{ imageId, imageUrl, templateIds[], bgModel: 'birefnet'|'bria'|'pixelcut', options: { bgRemove, seo } }`

### SEO (`src/routes/seo.routes.js` + `seo-knowledge.routes.js`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/seo/generate` | Generate Etsy SEO (title/description/13 tags) |
| GET | `/api/seo-knowledge` | Active knowledge base for workspace |
| POST | `/api/seo-knowledge/auto-update` | Claude-powered KB refresh |
| POST | `/api/seo-knowledge/manual` | Manual content override |
| POST | `/api/seo-knowledge/activate/:id` | Activate specific version |

### Mockup Templates (`src/routes/mockup-template.routes.js`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/mockups/templates` | Upload template (base + mask + shadow + dark variant) |
| GET | `/api/mockups/templates` | List all templates for workspace |
| GET | `/api/mockups/templates/presets` | Built-in preset templates |
| GET | `/api/mockups/templates/:id` | Single template |
| PATCH | `/api/mockups/templates/:id` | Update template config |
| DELETE | `/api/mockups/templates/:id` | Delete template |
| POST | `/api/mockups/templates/detect-print-area` | AI print area detection from image |
| POST | `/api/mockups/templates/bulk-upload` | Upload multiple templates |
| POST | `/api/mockups/templates/render-video` | Animated video mockup (kling-video) |

### Mockup Rendering (`src/routes/mockup.routes.js`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/mockups/render` | Sharp-based composite (template + design → output) |
| POST | `/api/mockups/render-batch` | Render same design across multiple templates |

### Ideas (`src/routes/idea.routes.js`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ideas/generate` | Generate ideas from niche/keyword/persona |
| GET | `/api/ideas` | List workspace ideas |
| POST | `/api/ideas/:id/status` | Update idea status |
| POST | `/api/ideas/:id/factory` | Send idea to factory |
| POST | `/api/ideas/generate-bulk` | Bulk generate via Claude Haiku with brain context |

### Analytics & Export
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/analytics/import` | CSV import → ProductPerformance upsert |
| GET | `/api/analytics/performance` | Performance table data |
| POST | `/api/export/etsy` | Etsy-formatted CSV export |
| GET | `/api/export/job/:jobId/bundle` | ZIP bundle of job's images |

### Product Packs (`src/routes/product-pack.routes.js`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/packs/products` | Available product types |
| GET | `/api/packs` | List workspace packs |
| POST | `/api/packs` | Create pack |
| POST | `/api/packs/:packId/run` | Run pack generation |
| DELETE | `/api/packs/:packId` | Delete pack |

### AI Brain (`src/routes/brain.routes.js`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/brain` | List all corporate memories |
| GET | `/api/brain/knowledge` | Grouped knowledge entries (video/text/auto) |
| GET | `/api/brain/summary` | Entry count + last updated date |
| POST | `/api/brain/ingest-video` | Gemini Vision ingestion (legacy) |
| POST | `/api/brain/analyze-video` | Claude Vision + Whisper transcription |
| POST | `/api/brain/add-text` | Ingest article/text with structured insights |
| POST | `/api/brain/test-knowledge` | Query RAG with a question |
| DELETE | `/api/brain/:id` | Delete memory entry |

### Autonomous Agent (`src/routes/agent.routes.js`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agent/audit` | Shop audit → AI action plan (Gemini) |
| POST | `/api/agent/execute-action` | Execute UPDATE_PRICE or UPDATE_SEO via Playwright |

### Etsy Browser (`src/routes/etsy-browser.routes.js`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/etsy-browser/create-draft` | Fill Etsy listing form via Playwright |
| POST | `/api/etsy-browser/dispatch` | Assemble SEO+mockups → create-draft |
| POST | `/api/etsy-browser/scrape` | Scrape seller dashboard listings |
| POST | `/api/etsy-browser/pin-pinterest` | Auto-pin design to Pinterest |

### Radar & Trends
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/radar/scan` | Scrape rival Etsy shops for trends |
| GET | `/api/trends/weekly` | Keyword trends + niche analysis via Claude |
| GET | `/api/trends/seasonal` | Full-year seasonal calendar |

### Fulfillment (`src/routes/fulfillment.routes.js`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/fulfillment/orders` | List orders (mock until Yuppion API) |
| POST | `/api/fulfillment/create` | Submit order to Yuppion factory (mock) |

### Other
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/billing/plans` | Available subscription plans |
| GET | `/api/billing/usage` | Current workspace usage |
| POST | `/api/billing/checkout` | Stripe checkout session |
| POST | `/api/billing/webhook` | Stripe webhook handler |
| GET | `/api/billing/portal` | Stripe customer portal |
| POST | `/api/notifications/log` | Log notification |
| GET | `/api/notifications` | Last 20 notifications |
| POST | `/api/notifications/read-all` | Mark all read |

---

## All Frontend Pages

| Path | Client Component | Description |
|------|-----------------|-------------|
| `/dashboard/overview` | OverviewClient.tsx | Stats, spend, weekly chart, top images, quick actions, recent mockups, knowledge count |
| `/dashboard/factory` | FactoryClient.tsx | Main pipeline: upload → vision → prompt → generate. History dropdown, "To Mockup"/"To Remove BG" buttons |
| `/dashboard/gallery` | GalleryClient.tsx | Image history, approve/reject, bulk ops, one-click pipeline modal with BG model selector |
| `/dashboard/mockups` | MockupsClient.tsx | Template picker + Konva placement editor + bulk render. Dark/light toggle, save to gallery, pin to Pinterest |
| `/dashboard/tools` | ToolsClient.tsx | Unified tools hub with 3 tabs: BG Kaldır (up to 5 images), Upscale (1x–8x), Vektör (Recraft v3). Tab persisted via `?tab=` URL param. Old individual pages still exist for backwards compat. |
| `/dashboard/seo` | SeoClient.tsx | Etsy SEO generator with checklist, copy helper, "Publish to Etsy" button |
| `/dashboard/etsy-mode` | EtsyModeClient.tsx | Keyword → niche → style → generation workflow |
| `/dashboard/etsy-listings` | EtsyListingsClient.tsx | Scrape shop listings, per-listing SEO optimization with before/after |
| `/dashboard/ideas` | IdeasClient.tsx | Bulk idea generation, trending niche chips, sort, bulk send to factory |
| `/dashboard/packs` | PacksClient.tsx | Product pack templates |
| `/dashboard/orders` | OrdersClient.tsx | Fulfillment orders (mock data — Yuppion API pending) |
| `/dashboard/billing` | BillingClient.tsx | Subscription plans + Stripe checkout |
| `/dashboard/settings` | SettingsClient.tsx | Workspace config, per-provider API key management, daily spend limit |
| `/dashboard/analytics` | AnalyticsClient.tsx | CSV import, performance table, best listing, cost per approved, week-over-week |
| `/dashboard/exports` | ExportsClient.tsx | Date range filter, status filter, mockups-only toggle, ZIP/CSV download |
| `/dashboard/radar` | RadarClient.tsx | Competitor shop scraping + trending design analysis |
| `/dashboard/trends` | TrendsClient.tsx | Weekly hot niches + seasonal calendar, Generate Design/SEO actions |
| `/dashboard/agent` | AgentClient.tsx | Autonomous shop audit + execute price/SEO actions |
| `/dashboard/brain` | BrainClient.tsx | Upload video/text, browse memories, test knowledge (3 tabs) |

---

## All Services

| File | What it does |
|------|-------------|
| `vision.service.js` | Multi-provider image analysis: Anthropic Claude → Gemini → OpenAI fallback chain |
| `generation.service.js` | FAL.ai image generation, retry with exponential backoff, daily cap enforcement |
| `variation.service.js` | Color/style variation generation from base prompt |
| `prompt.service.js` | Prompt synthesis and template management |
| `mockup-render.service.js` | Sharp-based compositing: load base → resize design → composite → export. Supports multi print areas (printAreas array) |
| `storage.service.js` | Supabase file upload + asset URL resolution |
| `seo-knowledge.service.js` | SEO KB management: auto-generate via Claude, manual override, getKnowledge() |
| `seo-content.service.js` | Etsy SEO content generation (title ≤140, description, 13 tags) |
| `knowledge-context.service.js` | **Central context provider** — fetches relevant brain memories + SEO KB and injects into AI calls. Functions: getSeoContext(), getFactoryContext(), getIdeasContext() |
| `etsy-browser.service.js` | Playwright automation: launchBrowser(), createEtsyDraft(), scrapeListings(), pinToPinterest(), updateListing() |
| `etsy-mode.service.js` | Etsy-specific workflow: keyword → niche → style → generation |
| `listing-assembler.service.js` | Assembles final Etsy listing from SEO + mockup images → dispatches to etsy-browser. **BUG: uses wrong Prisma model name (see Known Issues)** |
| `competitor-radar.service.js` | Playwright rival shop scraper: [data-listing-id] selectors, page.close() for session preservation |
| `multimodal-brain.service.js` | Corporate memory: ffmpeg frame extraction + Whisper transcription + Claude Vision per-frame + synthesis. addTextKnowledge(), extractSeoKnowledge() auto-merges insights |
| `autonomous-manager.service.js` | Shop audit via Gemini: runDailyAudit() returns action plan |
| `fulfillment.service.js` | Yuppion factory orders: createOrder() (mock when no API key), syncEtsyOrders() (returns hardcoded mock) |
| `keyword-research.service.js` | Etsy autocomplete → real search suggestions, expandKeywords() |
| `product-pack.service.js` | Multi-item product bundle management |
| `risk.service.js` | Trademark/banned word checker for generated content |
| `analytics.service.js` | Usage aggregation + ProductPerformance reporting |
| `billing.service.js` | Stripe integration: checkout session, webhook handler, customer portal. Falls back to mock URLs when Stripe not configured |
| `log.service.js` | Job event logging to JobLog table |
| `secrets.service.js` | API key resolution: WorkspaceApiKey DB → process.env → throw |
| `providers/fal.provider.js` | FAL.ai client: Flux Dev/Schnell, Ideogram, Recraft, BiRefNet, Bria, ESRGAN, AuraSR |

---

## Database Models

| Model | Key Fields | Purpose |
|-------|-----------|---------|
| `User` | email, passwordHash | Authentication |
| `Workspace` | name, slug, dailyImageCap, concurrentJobCap, planName, stripeCustomerId | Tenant unit with billing |
| `WorkspaceMember` | userId, workspaceId, role | User ↔ workspace mapping |
| `WorkspaceApiKey` | workspaceId, provider, keyValue | Per-workspace provider key overrides (plain text MVP) |
| `DesignJob` | workspaceId, originalImage, status, mode, keyword, niche, style, packId | A generation run |
| `Image` | jobId, engine, imageUrl, status, isApproved, cost, performanceScore | Generated image |
| `Mockup` | imageId, templateId, mockupUrl | Rendered mockup result |
| `SEOData` | imageId (unique), title, description, tags[] | Etsy SEO per image |
| `VisionAnalysis` | imageId, jobId, parsedVisionJson | Vision analysis result |
| `JobLog` | jobId, eventType, status, data | Event log per job |
| `Idea` | workspaceId, niche, mainKeyword, persona, hook, styleEnum | Batch idea |
| `ProductPerformance` | imageId (unique), impressions, visits, favorites, orders, score | Etsy metrics |
| `ProductPack` | workspaceId, name | Multi-item bundle |
| `ProductPackItem` | packId, productType, placementConfig | Individual item in pack |
| `SeoKnowledgeBase` | workspaceId, content, source, isActive | SEO knowledge (auto/manual) |
| `MockupTemplate` | workspaceId, name, category, baseImagePath, maskImagePath, darkImagePath, configJson | Template config with print areas |
| `CorporateMemory` | workspaceId, type, title, content, category, tags[], vectorEmbedding | Brain RAG entries |

**Enums:** JobStatus (PENDING/PROCESSING/COMPLETED/FAILED/BUDGET_EXCEEDED), ImageStatus (GENERATED/APPROVED/REJECTED/PROCESSED/FAILED/COMPLETED)

---

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://...         # Prisma primary (Supabase pooled)
DIRECT_URL=postgresql://...           # Prisma direct (for migrations)

# Server
PORT=3001                             # index.js defaults to 3000 — override here

# AI Providers
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_GEMINI_API_KEY=...             # Also checked as GOOGLE_API_KEY
FAL_API_KEY=...                       # Flux, Schnell, Ideogram, Recraft, BiRefNet, Bria, upscalers
PIXELCUT_API_KEY=...

# Storage
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...              # Used in index.js (not SUPABASE_SERVICE_ROLE_KEY)

# Cost Control
DAILY_BUDGET_CAP=5.00                 # Hard cap on FAL spend per day
FAL_COST_PER_IMAGE=0.003              # Flat rate per image (all models)

# Frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001

# Billing (optional — falls back to mock URLs if not set)
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...        # Create in Stripe Dashboard first
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_UNLIMITED=price_...

# Fulfillment (mock until API received from Yuppion)
YUPPION_API_KEY=...
DEFAULT_LISTING_PRICE=19.99

# Etsy (pending API approval)
ETSY_API_KEY=...
ETSY_API_SECRET=...
ETSY_REDIRECT_URI=...

# Browser Automation (Playwright)
BROWSER_USER_DATA=...                 # Persistent Chrome profile path (keeps Etsy session)
BROWSER_EXE=...                       # Chrome executable path

# CORS (currently hardcoded in index.js — should be moved to env)
# CORS_ORIGIN=http://localhost:3001
```

---

## Key Workflows

### 1. Full Design Pipeline (Factory Page)
```
User uploads reference image
  → POST /api/factory/analyze (vision: Anthropic/Gemini/OpenAI)
  → POST /api/factory/get-variations (prompts + knowledge-context.service.js injection)
  → POST /api/factory/generate (FAL.ai: Flux/Ideogram/Recraft)
  → Image saved to DB (DesignJob + Image records)
  → Gallery page: approve → pipeline
```

### 2. One-Click Pipeline (Gallery Page → ⚡ button)
```
PipelineModal opens with:
  - BG model selector (BiRefNet/Bria/Pixelcut)
  - Template grid (up to 5 selected)
  - Step toggles (BG Remove, SEO)

POST /api/pipeline/one-click runs synchronously:
  Step 1: fal.subscribe(selectedBgModel, { image_url })
          → saves result to "processed" DesignJob
  Step 2: renderMockup(template, bgRemovedImageId) × N templates
          → saves results to "mockup_gallery" DesignJob
  Step 3: vision → expandKeywords → Claude Haiku SEO
          → returns title/description/tags in response
```

### 3. Etsy Draft Publishing (Current — Playwright)
```
SEO page → "Publish to Etsy" button
  → POST /api/etsy-browser/create-draft
  → Playwright opens etsy.com/sell/listings/new
  → Fills title, description, tags, price, uploads images
  → Saves as draft

OR via Gallery dispatch:
  → POST /api/etsy-browser/dispatch
  → listing-assembler.service.js fetches SEOData + mockup images
  → calls createEtsyDraft()
```

### 4. Knowledge Brain Loop
```
User uploads video/text to Brain page
  → multimodal-brain.service.js processes it
  → Stores in CorporateMemory table with category + tags
  → extractSeoKnowledge() auto-merges SEO insights into SeoKnowledgeBase

On every AI call (SEO, Factory, Ideas):
  → knowledge-context.service.js fetches relevant CorporateMemory entries
  → Merges with active SeoKnowledgeBase
  → Injects as system context into Claude/Gemini call
```

### 5. Mockup Rendering
```
User selects template + design in Mockups page
  → POST /api/mockups/render
  → mockup-render.service.js:
      1. Load base template (Sharp)
      2. Fetch design image
      3. Apply printArea placement (normalized 0–1 coords)
      4. Composite with blend mode
      5. Save to assets/outputs/ or Supabase
  → Result shown in TemplateEditor with download + save-to-gallery + pin-to-Pinterest
```

---

## Known Issues & Bugs

| # | Location | Bug | Severity |
|---|----------|-----|----------|
| 1 | `src/index.js:45` | CORS origin hardcoded to `http://localhost:3001` — will reject all production traffic | **Deploy blocker** |
| 2 | `src/services/fulfillment.service.js:60` | `syncEtsyOrders()` returns 1 hardcoded mock order regardless of workspace | Minor (expected) |
| 3 | `src/services/billing.service.js:121,198` | Checkout + portal return mock `localhost:3001` URLs when Stripe not configured | Minor (dev only) |

*Previously documented Bug #1 (listing-assembler prisma.sEOContent) — already fixed in the codebase.*
*Previously documented Bug #3 (avgGenerationTime null) — already fixed in the codebase.*

---

## Development Guidelines

### Adding a Backend Route
1. Create `src/routes/feature.routes.js`
2. Register in `src/index.js`: `app.use('/api/feature', require('./routes/feature.routes'))`
3. **Every DB query MUST filter by `req.workspaceId`** — this is how multi-tenancy works
4. Create `src/services/feature.service.js` if logic is complex

### Adding a Frontend Page
1. Create `frontend/app/dashboard/page-name/page.tsx` — thin server component:
   ```tsx
   import { PageNameClient } from './PageNameClient';
   export default function PageNamePage() { return <PageNameClient />; }
   ```
2. Create `frontend/app/dashboard/page-name/PageNameClient.tsx` — `'use client'`, all logic here
3. Add nav link to `frontend/components/layout/Sidebar.tsx`
4. Add API functions to `frontend/lib/api.ts`

### Database Changes
```bash
# 1. Edit prisma/schema.prisma
# 2. Create migration
npx prisma migrate dev --name descriptive_name
# 3. Regenerate client
npx prisma generate
# 4. Verify with
npx prisma studio
```

### Adding API Context Injection
All AI calls should inject business knowledge via `knowledge-context.service.js`:
```js
const { getSeoContext } = require('../services/knowledge-context.service');
const knowledge = await getSeoContext(req.workspaceId);
// Pass knowledge as system prompt prefix to your Claude/Gemini call
```
Functions available: `getSeoContext()`, `getFactoryContext()`, `getIdeasContext()`, `getRelevantContext(topic)`, `getKnowledgeSummary()`

### Design System
- **Accent:** Electric Violet `#7c3aed` → `var(--accent)` token
- **Background:** `#08090a`, **Cards:** `bg-[#111827]` or `bg-slate-800/40`
- **Primary CTA:** `bg-gradient-to-r from-purple-600 to-blue-600`
- **Font:** Geist sans + Geist Mono for code/logs
- Tokens in `frontend/app/globals.css` — use existing tokens, never invent new colors
- Dark/light mode: `html.light` class overrides in globals.css

---

## For New AI Assistants

### Who is the owner?
Anılcan — an Etsy POD entrepreneur setting up a fully automated store. He is a full-stack developer (Node.js/Express, Next.js, Prisma). Communicates in Turkish. Prefers fast iteration, comprehensive features. Goal: run the Etsy store with minimum manual work.

### What is the business goal?
Automated Etsy POD store: design → generate → mockup → list → fulfill → track → learn → repeat. The platform should eventually run the complete loop with almost no human intervention.

### Key pending integrations
- **Etsy API:** Applied but not yet approved. Currently using Playwright browser automation as workaround. When approved, build official OAuth + listing endpoints.
- **Yuppion:** POD factory partner. API access pending first order. fulfillment.service.js has the structure ready — just needs real API key + Etsy order sync.

### The Brain system is central
`CorporateMemory` + `SeoKnowledgeBase` feed into ALL AI calls via `knowledge-context.service.js`. When adding any new AI feature, always call the appropriate context function (`getSeoContext`, `getFactoryContext`, etc.) and pass it as system context. This is how the platform learns from uploaded videos, meeting notes, and Etsy trend articles over time.

### Etsy listing flow (Playwright vs API)
Currently: Playwright fills the Etsy listing form in a logged-in browser session (`BROWSER_USER_DATA` keeps the session alive). This works but is fragile — Etsy UI changes break it. When the official API is approved, the Playwright path should be replaced (keep `etsy-browser.service.js` only for scraping/research).

### Pipeline architecture
- `one-click` = synchronous, blocks until done, good for single images
- `pipeline/run` + `run-job` = async via BullMQ, good for batch processing

### Critical bug to fix first
`listing-assembler.service.js:27` uses `prisma.sEOContent` (wrong). This crashes every time `/api/etsy-browser/dispatch` is called. Change to `prisma.sEOData`. See Known Issues section.
