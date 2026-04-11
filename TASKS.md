# POD AI Factory — Task Board & Project Status

Last updated: April 11, 2026

---

## ✅ COMPLETED FEATURES

### Core Infrastructure
- Multi-tenant workspace system (User, Workspace, WorkspaceMember, WorkspaceApiKey)
- Cookie-based auth: POST /api/auth/login, /logout, GET /me
- Workspace middleware: extracts workspaceId from cookie, attaches to req.workspaceId
- Per-workspace API key overrides via secrets.service.js (DB first → env fallback)
- BullMQ + Redis job queue for background asset processing (src/queues/asset.worker.js)
- Supabase storage bucket auto-created on startup (mockup-outputs, 50MB limit)
- Per-image cost tracking (Image.cost field, daily/monthly aggregation in /api/status)
- Daily image cap + concurrent job cap per workspace (stored in Workspace model)
- Global error handler + health check (GET /health)

### Factory Pipeline (src/routes/factory.routes.js)
- POST /api/factory/analyze — multi-provider vision (Anthropic → Gemini → OpenAI fallback)
- POST /api/factory/get-variations — prompt variations with knowledge context injection
- POST /api/factory/generate — image generation via FAL.ai
- POST /api/factory/retry/:jobId — retry failed jobs
- POST /api/factory/etsy-mode — keyword → niche → style → generation workflow
- GET /api/factory/models — supported model list
- Bulk upload: up to 8 images, each analyzed separately → variations
- Prompt history (localStorage, last 10, dropdown UI)
- "To Mockup" and "To Remove BG" buttons on each generated image

### Image Generation (src/services/generation.service.js)
- Flux Dev (quality), Flux Schnell (speed), Ideogram (typography), Recraft (vector)
- All via FAL.ai provider (src/services/providers/fal.provider.js)
- Retry logic with exponential backoff for 429 rate limits
- Daily budget cap enforcement (FAL_COST_PER_IMAGE env var)

### Gallery (src/routes/gallery.routes.js + GalleryClient.tsx)
- GET /api/gallery/:jobId — images for a specific job
- GET /api/gallery/recent — latest 100 images across all workspace jobs
- POST /:imageId/approve, /reject — approval workflow
- DELETE /:imageId — delete with workspace auth guard
- POST /:imageId/regenerate — regenerate from same prompt
- POST /save-mockup — save mockup render result to gallery
- Bulk approve/reject/delete/pipeline from toolbar
- URL state persistence (jobId in URL params)
- Grid layout: grid-cols-2 md:grid-cols-3 aspect-square cards

### One-Click Pipeline (src/routes/pipeline.routes.js + PipelineModal)
- POST /api/pipeline/one-click — BG Remove → Mockup → SEO in a single synchronous request
  - BG model selector: birefnet (free), bria pro, pixelcut (added Apr 11)
  - Renders up to 5 selected templates via Sharp
  - Vision analysis → keyword expansion → Claude Haiku → SEO output
  - Results saved to DB (processed job for BG, mockup_gallery job for mockups)
- POST /api/pipeline/run — enqueue single image to BullMQ (async)
- POST /api/pipeline/run-job/:jobId — enqueue all approved images, idempotent
- GET /api/pipeline/status/:jobId — progress check
- PipelineModal in GalleryClient.tsx: template grid (4 cols), model selector, step toggles

### Tools (src/routes/tool.routes.js)
- POST /api/tools/remove-bg — BiRefNet / Bria / Pixelcut
- POST /api/tools/upscale — ESRGAN / AuraSR / Ideogram (1x–8x)
- POST /api/tools/vectorize — vector conversion via fal-ai/recraft-v3
- Dedicated frontend pages: Remove BG (batch up to 5), Upscale, Vector

### Mockup System
- src/routes/mockup-template.routes.js: POST / (upload), GET /, GET /presets, GET /:id, PATCH /:id, DELETE /:id, POST /detect-print-area (AI), POST /bulk-upload, POST /render-video
- src/routes/mockup.routes.js: POST /render, POST /render-batch
- src/services/mockup-render.service.js: Sharp-based compositing engine
- Multi print area support (configJson.printAreas array, backward compat with single printArea)
- areaDesigns parameter accepted in render (different designs per area — backend ready)
- Konva-based DesignPlacementEditor.tsx in frontend
- Design picker from gallery job history
- Dark/light template variant toggle (darkImagePath field)
- Video mockup via fal-ai/kling-video (POST /render-video)
- Bulk render mode with per-template status display
- "Save to Gallery" and "Pin to Pinterest" buttons on render result
- Download with descriptive filename (mockup-{templateName}-{timestamp}.png)

### SEO (src/routes/seo.routes.js + seo-knowledge.routes.js)
- POST /api/seo/generate — Etsy SEO (title ≤140 chars, description, 13 tags)
- GET /api/seo-knowledge — active knowledge base for workspace
- POST /api/seo-knowledge/auto-update — Claude-powered KB refresh
- POST /api/seo-knowledge/manual — manual content override
- POST /api/seo-knowledge/activate/:id — activate specific version
- Weekly auto-update cron (src/jobs/seo-knowledge-updater.js)
- Etsy 2026 algorithm knowledge in default KB
- SEO copy helper: Etsy-paste format, checklist (title length, tag count, description words)
- "Publish to Etsy (Draft)" button in SEO page (via Playwright browser agent)

### Ideas (src/routes/idea.routes.js)
- POST /api/ideas/generate — AI ideas from niche/keyword/persona
- GET / — list workspace ideas
- POST /:id/status — update status
- POST /:id/factory — send to factory
- POST /generate-bulk — bulk generate via Claude Haiku with brain context injection
- Trending niche chips, sort toggle, bulk send, pending/approved counters

### Analytics & Exports
- POST /api/analytics/import — CSV import with ProductPerformance upsert
- GET /api/analytics/performance — analytics table data
- POST /api/export/etsy — Etsy-formatted CSV export
- GET /api/export/job/:jobId/bundle — ZIP bundle
- Best Listing card, Cost per Approved, week-over-week comparison

### Overview Dashboard (inline in src/index.js)
- GET /api/dashboard — runs, images, approved, spend, success rate, recent jobs, top approved, weeklyStats[]
- GET /api/status — FAL health (30s cache), daily/monthly spend, budget cap
- Quick actions grid (Factory, Remove BG, SEO, Upload Mockup)
- Recent mockups section, knowledge entries stat card
- Weekly bar chart (images vs approved per day)

### Competitor Intelligence
- POST /api/radar/scan — Playwright rival Etsy shop scraping (competitor-radar.service.js)
- GET /api/trends/weekly — weekly keyword trends via Etsy autocomplete + Claude analysis
- GET /api/trends/seasonal — full-year seasonal calendar
- Trends page: Hot Niches grid, Upcoming Opportunities, Avoid Now, monthly calendar

### AI Brain / Corporate Memory (src/routes/brain.routes.js)
- GET / — list memories, GET /knowledge — grouped by type
- POST /ingest-video — Gemini Vision (legacy), POST /analyze-video — Claude Vision + Whisper
- POST /add-text — text/article ingestion with structured insights
- POST /test-knowledge — query RAG with quick question chips
- GET /summary — entry count + last updated, DELETE /:id
- Categories: digital_products, etsy_algorithm, seo_tips, niche_research, pod_apparel, general_etsy
- Auto-merges SEO knowledge after analysis (extractSeoKnowledge)
- Universal knowledge injection: brain context piped into SEO, Factory, Ideas generators

### Autonomous Agent (src/routes/agent.routes.js)
- POST /api/agent/audit — shop audit → AI action plan (autonomous-manager.service.js, Gemini)
- POST /api/agent/execute-action — UPDATE_PRICE or UPDATE_SEO via Playwright

### Etsy Browser Automation (src/routes/etsy-browser.routes.js)
- POST /create-draft — Playwright fills Etsy listing form (title/desc/tags/price/images)
- POST /dispatch — listing-assembler.service.js assembles SEO+mockups → create-draft
- POST /scrape — scrape seller dashboard listings
- POST /pin-pinterest — auto-pin to Pinterest via Playwright
- Etsy Listings page: scan shop, per-listing "Optimize SEO" with before/after comparison

### Other Completed
- Notification system: in-memory per-workspace, bell icon + unread badge in Topbar
- Product Packs: CRUD + POST /api/packs/:packId/run
- Settings: workspace config, API key management
- Billing routes: GET /plans, /usage, POST /checkout, /webhook, /portal, /update-plan
- Dark/Light mode toggle (localStorage + CSS variable overrides in globals.css)
- Global keyboard shortcuts: Ctrl+Shift+F/G/S/M (Factory/Gallery/SEO/Mockups)
- Remove BG: batch processing up to 5 images, gallery picker, URL param preload

---

## 🔴 HIGH PRIORITY — Pending

### 1. BUG FIX: listing-assembler.service.js — Wrong Prisma Model
**File:** `src/services/listing-assembler.service.js` line 27
**Bug:** `prisma.sEOContent.findFirst(...)` — model `SEOContent` does not exist in schema. The correct model is `SEOData`.
**Impact:** Every call to `POST /api/etsy-browser/dispatch` will throw a runtime error.
**Fix:**
```js
// Current (broken):
const seoContent = await prisma.sEOContent.findFirst({
  where: { jobId: image.jobId }, orderBy: { createdAt: 'desc' }
});
// Correct:
const seoContent = await prisma.sEOData.findFirst({
  where: { imageId: image.id }
});
```
Also change `seoContent.title/description/tags` references below to match SEOData field names (they're the same, but verify).

### 2. Etsy Official API Integration
**Status:** Waiting for Etsy API key approval.
**Current workaround:** Playwright browser automation fills Etsy forms directly — fragile, breaks on UI changes.
**When key arrives, build:**
- Create `src/routes/etsy.routes.js` (NOT etsy-browser — separate file for official API)
- `GET /api/etsy/auth` — redirect to Etsy OAuth2 URL
- `GET /api/etsy/callback` — exchange code for access+refresh tokens, store in WorkspaceApiKey (provider='etsy')
- `POST /api/etsy/listings` — create listing via official Etsy v3 API
- Token refresh logic (Etsy tokens expire in 1 hour)
- Replace "Publish to Etsy" buttons in SEO + Gallery to use official API instead of Playwright
- Register route in src/index.js

### 3. Yuppion Fulfillment — Real API Integration
**Status:** Mock implementation, waiting for Yuppion API access.
**File:** `src/services/fulfillment.service.js`
**Current:** `createOrder()` returns fake `YUP-XXXXX` IDs when API key missing. `syncEtsyOrders()` returns 1 hardcoded mock order.
**When API access arrives:**
- Set `YUPPION_API_KEY` in .env
- Verify/update `this.apiUrl` base URL
- Replace `syncEtsyOrders()` mock with real Etsy Orders API (needs OAuth from Task #2)
- Wire OrdersClient.tsx to display real order data from GET /api/fulfillment/orders
- Add order status tracking (polling or webhooks)

---

## 🟡 MEDIUM PRIORITY — Pending

### 4. Stripe Billing — Real Price IDs
**File:** `src/services/billing.service.js` lines 13, 20, 27
**Current:** `process.env.STRIPE_PRICE_STARTER || 'price_starter_placeholder'`
**To do:**
- Create Starter/Pro/Unlimited products in Stripe Dashboard
- Set STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO, STRIPE_PRICE_UNLIMITED in .env
- Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET
- Test end-to-end: checkout → webhook → plan update
- Currently returns mock checkout URLs in dev (safe for UI testing)

### 5. CORS Origin — Hardcoded localhost
**File:** `src/index.js` line 45
**Current:** `cors({ origin: 'http://localhost:3001', credentials: true })`
**Fix:** `cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3001', credentials: true })`
**Severity:** Will block all production traffic. Must fix before deployment.

### 6. Dashboard — Average Generation Time
**File:** `src/index.js` line 305
**Current:** `avgGenerationTime: null // placeholder`
**Fix:** Add timestamp tracking — either `generationStartedAt` on DesignJob, or `durationMs` in JobLog when eventType='GENERATION_DONE'. Compute average in dashboard query.

### 7. areaDesigns — Multi-Area Mockup UI
**Backend:** Already works — `src/services/mockup-render.service.js` accepts `areaDesigns` map (area ID → design image) and composites each differently.
**Missing:** Frontend UI to assign different designs to different template print areas. Needed for multi-panel templates (front/back/sleeve on hoodies). Currently same design used for all areas.

### 8. Per-Model Cost Tracking
**File:** `src/services/generation.service.js`
**Current:** `FAL_COST_PER_IMAGE` is flat rate for all models. Flux Dev costs ~$0.03, Schnell ~$0.003, Ideogram ~$0.08.
**Fix:** Add model-to-cost map and use actual cost per generation for accurate spend tracking.

---

## 🔵 LOW PRIORITY / Future

### 9. Production Deployment
- Fix CORS (Task #5), configure NEXT_PUBLIC_API_BASE_URL for domain
- Set up production Redis (currently hardcoded localhost:6379)
- Add DIRECT_URL for Prisma (Supabase pooler vs direct connection)
- Process manager (PM2) for Node backend
- SSL/HTTPS setup

### 10. API Key Encryption
WorkspaceApiKey.keyValue stored as plain text. Schema comment: "replace with KMS in production." Encrypt with AES-256 or cloud KMS before handling real customer API keys.

### 11. Rate Limiting
No rate limiting middleware on routes. Add express-rate-limit on /api/factory, /api/generate, /api/tools endpoints. Also enforce workspace.concurrentJobCap in BullMQ queue (field exists in DB but not checked before enqueue).

### 12. Semantic Search on Corporate Memory
CorporateMemory.vectorEmbedding field exists (Json) but cosine similarity not implemented. /api/brain/test-knowledge does text matching only. Add OpenAI text-embedding-3-small + cosine search for better RAG quality.

### 13. Pinterest — Official API
`pinToPinterest()` uses Playwright automation — fragile. Pinterest has an OAuth API. Replace if pinning becomes a regular workflow step.

### 14. Auto Etsy Performance Sync
ProductPerformance populated via CSV import only. When Etsy OAuth is live, add scheduled polling to auto-update impressions/visits/favorites/orders.

### 15. Vector Page — Verify E2E
frontend/app/dashboard/vector/ + POST /api/tools/vectorize exist. Verify the endpoint works end-to-end and check which FAL model is called.

---

## 🐛 KNOWN BUGS

| # | Location | Bug | Severity |
|---|----------|-----|----------|
| 1 | `src/services/listing-assembler.service.js:27` | `prisma.sEOContent` — wrong model, should be `prisma.sEOData`. Crashes on every dispatch call. | **Critical** |
| 2 | `src/index.js:45` | CORS origin hardcoded to `http://localhost:3001` — blocks all prod traffic | **Deploy blocker** |
| 3 | `src/index.js:305` | `avgGenerationTime: null` hardcoded placeholder | Minor |
| 4 | `src/services/fulfillment.service.js:60` | `syncEtsyOrders()` returns 1 hardcoded mock order regardless of workspace | Minor (expected) |
| 5 | `src/services/billing.service.js:121,198` | Checkout + portal return mock localhost URLs when Stripe not configured | Minor (dev only) |

---

## 📝 DEVELOPMENT NOTES

### Tech Stack
| Component | Technology | Version |
|-----------|-----------|---------|
| Backend | Node.js + Express | Express 5 |
| Frontend | Next.js App Router + React | Next 14, React 19 |
| Database | PostgreSQL + Prisma ORM | Prisma 5.15 |
| Job Queue | BullMQ + Redis | BullMQ 5.70 |
| Storage | Supabase Storage + local assets/ | |
| Vision AI | Anthropic Claude, Gemini, OpenAI | Multi-provider fallback |
| Image Gen | FAL.ai (Flux Dev/Schnell, Ideogram, Recraft) | |
| BG Remove | BiRefNet, Bria, Pixelcut | via FAL.ai |
| Upscale | ESRGAN, AuraSR, Ideogram | via FAL.ai |
| Browser | Playwright + Chromium | Etsy/Pinterest automation |
| UI | Tailwind v4, Radix UI, Lucide, Konva, Recharts | |

### Ports
- **Backend:** http://localhost:3001 (PORT in .env — note: index.js defaults to 3000 but .env overrides to 3001)
- **Frontend:** http://localhost:3000
- **Redis:** localhost:6379 (hardcoded, no env config)
- **PostgreSQL:** via DATABASE_URL in .env

### Running the Project
```bash
npm run dev            # Kills ports 3000+3001, starts both servers
npm run dev:backend    # Backend with nodemon (ignores assets/)
npm run dev:frontend   # Frontend Next.js dev server
npm start              # Production mode (both)
```

### Environment Variables
```env
# Database
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...          # For Prisma migrations via Supabase pooler

# Server
PORT=3001

# AI Providers
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_GEMINI_API_KEY=...            # Also accepts GOOGLE_API_KEY
FAL_API_KEY=...                      # Flux, Schnell, Ideogram, Recraft, BiRefNet, Bria, upscalers
PIXELCUT_API_KEY=...

# Storage
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...

# Billing (optional — falls back to mock URLs)
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_UNLIMITED=price_...

# Cost Control
DAILY_BUDGET_CAP=5.00
FAL_COST_PER_IMAGE=0.003

# Frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001

# Fulfillment (mock until key received)
YUPPION_API_KEY=...
DEFAULT_LISTING_PRICE=19.99

# Etsy (pending approval)
ETSY_API_KEY=...
ETSY_API_SECRET=...
ETSY_REDIRECT_URI=...

# Browser Automation
BROWSER_USER_DATA=...                # Persistent Chrome profile path
BROWSER_EXE=...                      # Chrome executable path
```

### Key Architectural Decisions

**Multi-tenant isolation:** Every DB query filters by `req.workspaceId` (set by workspace middleware from session cookie). New routes MUST include workspace scoping.

**Provider fallback:** Vision: Anthropic → Gemini → OpenAI (auto-fallback). Generation: user-selected model, no auto-fallback.

**API key resolution (secrets.service.js):** WorkspaceApiKey DB → process.env → throw. Each workspace can override global keys.

**Etsy integration (current):** Playwright browser automation as workaround. Logs into Etsy with a persistent Chrome session and fills forms. Fragile — Etsy UI changes break it silently. Official API integration is Task #2.

**Pipeline modes:** `/api/pipeline/one-click` = synchronous (blocks request). `/api/pipeline/run` and `/run-job/:jobId` = async via BullMQ.

**Knowledge injection:** Brain memories are injected as context into SEO, Factory, and Ideas generators via knowledge-context.service.js. SEO Knowledge Base is auto-refreshed weekly via cron.

**Adding a backend route:**
1. Create `src/routes/feature.routes.js`
2. Register in `src/index.js`: `app.use('/api/feature', require('./routes/feature.routes'))`
3. All queries MUST filter by `req.workspaceId`

**Adding a frontend page:**
1. `frontend/app/dashboard/page-name/page.tsx` (thin server component)
2. `frontend/app/dashboard/page-name/PageNameClient.tsx` ('use client', all logic)
3. Add nav entry to `frontend/components/layout/Sidebar.tsx`
4. Add API functions to `frontend/lib/api.ts`

**DB migrations:**
```bash
npx prisma migrate dev --name descriptive_name
npx prisma generate
```

### Prisma Schema — 17 Models
User, Workspace, WorkspaceMember, WorkspaceApiKey, DesignJob, Image, Mockup, SEOData, VisionAnalysis, JobLog, Idea, ProductPerformance, ProductPack, ProductPackItem, SeoKnowledgeBase, MockupTemplate, CorporateMemory

### Design System
- Accent: Electric Violet `#7c3aed` → `var(--accent)`
- Background: `#08090a`, Cards: `bg-[#111827]`
- Primary CTA: `bg-gradient-to-r from-purple-600 to-blue-600`
- Font: Geist sans + Geist Mono
- Sidebar: 220px fixed, left border active highlight
- Tokens in `frontend/app/globals.css` — use existing tokens only
