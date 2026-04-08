# POD AI Factory — Task Queue

## 🔴 HIGH PRIORITY

### ~~1. Mockup Template Upload Tool~~ ✅ DONE
Completed: TemplateUploader.tsx with visual print area selector, integrated into MockupsClient.tsx showUpload modal.

---

### ~~2. Mockup Design Picker — Job History~~ ✅ DONE
Completed: DesignPickerModal rewritten — auto-loads job history on open (GET /api/jobs), shows jobs as a clickable sidebar list, clicking a job loads its approved designs. No more manual Job ID entry.

---

### ~~3. Download Button Fix in Mockups~~ ✅ DONE
Completed: "Open full size" replaced with a "Download" button that fetches the blob and triggers download with filename `mockup-{templateName}-{timestamp}.png`. Falls back to new tab on fetch error.

---

### ~~10. Factory → Send to Mockup~~ ✅ DONE
Completed: Added "To Mockup" button on each generated image in FactoryClient.tsx using router.push(). Navigates to /dashboard/mockups?designUrl=...&designImageId=... with the current display URL and gallery image ID. MockupsClient reads both params via useSearchParams and seeds TemplateEditor's designUrl/designImageId state on open.

---

### ~~11. Bulk Render~~ ✅ DONE
Completed: Added "Bulk Render" toggle button in MockupsClient header. Bulk panel shows design picker + template count + Render button. Template cards show checkboxes when in bulk mode. Uses existing renderBatch API. Results grid shows per-template status and individual download buttons.

---

### ~~12. Render → Save to Gallery~~ ✅ DONE
Completed: Added POST /api/gallery/save-mockup backend endpoint (finds-or-creates a "Mockup Gallery" DesignJob, creates Image record with isApproved=true). Added apiGallery.saveMockup() in api.ts. Added "Save to Gallery" button next to Download in TemplateEditor renderResult panel.

---

### ~~13. Dark/Light Template Support~~ ✅ DONE
Completed: Added darkImagePath String? to prisma/schema.prisma MockupTemplate model. Added darkImagePath?: string | null to MockupTemplate TypeScript interface. Backend PATCH endpoint now accepts darkImagePath. TemplateEditor shows ☀ Light / ☾ Dark toggle when darkImagePath is set; canvas reloads base image on toggle.

---

### ~~14. Vector Conversion (PNG → SVG)~~ ✅ DONE
Completed: Added POST /api/tools/vectorize backend endpoint using fal-ai/recraft-v3 with style="vector_illustration". Added apiTools.vectorize() in api.ts. Created /dashboard/vector page (VectorClient.tsx) with drag-and-drop upload, before/after display, and download button. Added Vector nav item to Sidebar.

---

### ~~A. Factory → To Mockup (router.push)~~ ✅ DONE
Completed: Updated FactoryClient.tsx — replaced <Link> with router.push() via useRouter. Button relabeled "To Mockup". Added useRouter import from next/navigation.

---

### ~~B. Settings — Daily Spend Limit~~ ✅ DONE
Completed: Added "Daily Spend Limit" card to SettingsClient.tsx. Value stored in localStorage as 'fal_daily_limit'. OverviewClient reads it on mount and shows "$X.XX / $Y.YY" in the Spend Today stat card.

---

### ~~C. Overview — Recent Mockups~~ ✅ DONE
Completed: Added "Recent Mockups" section in OverviewClient.tsx. Calls apiGallery.getRecent(), filters engine === 'mockup', shows last 6 as thumbnail grid with links to /dashboard/mockups. Section only renders when mockups exist.

---

### ~~E. SEO Copy Helper~~ ✅ DONE
Completed: copyAll now outputs Etsy-paste format (title\n\ndescription\n\ntags, no labels). Added "Etsy Checklist" section after Tags card — checks title ≤140 chars, 13 tags used, description 150–300 words, no keyword stuffing (word appearing >5× in title+description).

---

### ~~F. Gallery Bulk Approve improvements~~ ✅ DONE
Completed: bulkApprove now shows a progress toast "Approving X of Y…" via toast.loading with a stable ID. Approve button in toolbar now shows "Approve (X)" with the selected count.

---

### ~~G. Ideas — Trending Niches + Generate Bulk~~ ✅ DONE
Completed: Added "Generate from Niche" card in IdeasClient.tsx with 10 trending niche chips, custom niche text input, and "Generate 5 Ideas" button. Added POST /api/ideas/generate-bulk backend endpoint using Claude Haiku (claude-haiku-4-5-20251001). Added apiIdeas.generateBulk(niche) in api.ts.

---

### ~~H. Exports Page Improvements~~ ✅ DONE
Completed: Added date range filter (7d / 30d / all), status filter (all / approved only), mockups-only toggle. Stats bar shows file count + estimated ZIP size. "Export Mockups Only" panel at top shows mockup thumbnails across all jobs with individual download links. Assets table now shows createdAt column and respects all active filters.

---

### ~~I. Analytics Page Improvements~~ ✅ DONE
Completed: Added "Best Listing" card (top score SKU), "Cost per Approved" card (weekly spend / weekly approved from dashboard stats), "This Week vs Last Week" comparison with % diff arrow. Export CSV button downloads current sorted performance data as analytics-YYYY-MM-DD.csv. Imported apiDashboard for weekly stats.

---

### ~~J. Overview — Quick Actions~~ ✅ DONE
Completed: Added "Quick Actions" 2x2 grid section in OverviewClient.tsx between Recent Mockups and Projects Grid. 4 color-coded buttons: New Generation → /dashboard/factory, Remove BG → /dashboard/remove-bg, Generate SEO → /dashboard/seo, Upload Mockup → /dashboard/mockups.

---

### ~~K. Global Keyboard Shortcuts~~ ✅ DONE
Completed: Created frontend/hooks/useKeyboardShortcuts.ts with Ctrl+Shift+F (Factory), Ctrl+Shift+G (Gallery), Ctrl+Shift+S (SEO), Ctrl+Shift+M (Mockups). Created frontend/components/ShortcutsInit.tsx (client wrapper). Imported in dashboard layout.tsx. Added "Keyboard shortcuts" button in Sidebar footer that opens a popover listing all shortcuts.

---

### ~~L. Factory — Prompt History~~ ✅ DONE
Completed: Added promptHistory state (localStorage 'prompt_history', last 10). saveToHistory() called on every Generate. "History (N)" button next to Templates in the prompt header opens a dropdown of clickable past prompts. "Clear history" link at bottom removes all entries.

---

### ~~M. Remove BG — Batch Processing~~ ✅ DONE
Completed: Rewrote RemoveBgClient.tsx. Accepts up to 5 images via drag-drop or file picker. Each image is shown as a card with Before/After display, individual "Remove BG" button, and download button after processing. "Process All (N)" button runs BiRefNet on all idle/errored images simultaneously via Promise.all. Model selector (BiRefNet / Bria Pro / Pixelcut) applies to all operations.

---

### ~~N. Dark/Light Mode Toggle~~ ✅ DONE
Completed: Added `html.light` CSS variable overrides in globals.css (bg-base #f8fafc, text-primary #0f172a, etc.). Added theme toggle button in Sidebar footer (Sun/Moon icon, "Light mode"/"Dark mode" label). Stores preference in localStorage 'theme'. Applies/removes 'light' class on html element via useEffect on mount + on toggle.

---

### ~~O. Notification System~~ ✅ DONE
Completed: Created src/routes/notification.routes.js — in-memory per-workspace log (Map), POST /api/notifications/log, GET /api/notifications (last 20), POST /api/notifications/read-all. Registered in index.js. Added logNotification() calls in seo.routes.js (SEO generated) and tool.routes.js (BG removed, vector converted). Added apiNotifications interface + client to api.ts. Added Bell icon to Topbar with unread badge, dropdown with activity feed (color-coded by type, timestamps, mark-all-read button). Auto-marks read after 1.5s when opened.

---

### ~~T. Playwright — Etsy Browser Automation~~ ✅ DONE
Completed: Installed Playwright + Chromium. Created src/services/etsy-browser.service.js with launchBrowser() (persistent Chrome profile), createEtsyDraft() (fills title/description/tags/price/images, saves as draft), scrapeListings() (paginates seller dashboard), pinToPinterest() (pin builder flow). Created src/routes/etsy-browser.routes.js with POST /api/etsy-browser/create-draft, /scrape, /pin-pinterest. Registered in index.js. Added BROWSER_USER_DATA and BROWSER_EXE to .env.example.

---

### ~~U. SEO Client — "Publish to Etsy" button~~ ✅ DONE
Completed: Added publishing/publishResult state to SEOClient.tsx. Added handlePublishToEtsy() — POSTs to /api/etsy-browser/create-draft with title/description/tags/imageUrls. Added "Publish to Etsy (Draft)" button (orange, with Loader2 spinner) below "Copy All" button, only visible when result is ready.

---

### ~~V. Pinterest Auto-Pin after Mockup Render~~ ✅ DONE
Completed: Added "Pin to Pinterest" button in the renderResult panel of TemplateEditor (MockupsClient.tsx). POSTs to /api/etsy-browser/pin-pinterest with imageUrl, template name, description, and shop link. Shows success/error via addToast.

---

### ~~W. Etsy Listing Scraper page~~ ✅ DONE
Completed: Created frontend/app/dashboard/etsy-listings/page.tsx and EtsyListingsClient.tsx. "Scan My Etsy Shop" button calls POST /api/etsy-browser/scrape. Lists scraped listings (id, title, price) in expandable cards. "Optimize SEO" button per listing calls /api/seo/generate with listing title as keyword. Shows before/after comparison panel with AI title, description, and tags preview. Added "My Listings" (Store icon) to Sidebar nav.

---

### ~~X. Mockup System Fixes~~ ✅ DONE
Completed:
- Design Picker rebuilt: 4-col grid, filters by ID via search input, loads apiGallery.getRecent() filtered by engine !== 'mockup', max-w-4xl. Used for both single editor and bulk render.
- Rendered Mockups section: date-grouped accordion with Download + Delete (X) buttons per card. DELETE /api/gallery/:imageId backend endpoint added with workspace auth guard.
- saveMockup() accepts optional designImageId stored in image.seed for future grouping.
- Auto Detect Print Area: POST /api/mockups/templates/detect-print-area (sharp greyscale grid analysis). Button appears in TemplateUploader after template is uploaded. Updates printArea state on success.

---

### ~~Y. Remove BG + Gallery + Factory improvements~~ ✅ DONE
Completed:
- Remove BG — "Load from Gallery" button opens a 4-col gallery picker (apiGallery.getRecent filtered by engine !== 'mockup'), selected image added as a card. URL param `?imageUrl=` pre-loads image on mount (read via useSearchParams, Suspense wrapper added).
- Gallery — grid changed from masonry to grid-cols-2 md:grid-cols-3 aspect-square cards. Delete button (dark red) added to hover overlay per card. "Delete (N)" bulk button in toolbar. Backend DELETE /api/gallery/:imageId already existed.
- Factory — "To Remove BG" button added next to "To Mockup", navigates to /dashboard/remove-bg?imageUrl=... so the image pre-loads.

---

### 15. Etsy Draft Assembly (waiting for API approval)
When Etsy API is approved:
Combine mockup image + SEO content + pricing template
Push as draft listing to Etsy via POST /api/etsy/listings

---

### 16. Yuppion Integration (waiting for first order)
When first order arrives and API access is granted:
Add order fulfillment flow: Gallery approved image → Yuppion API → production order

---

## 🟡 MEDIUM PRIORITY

### 4. Etsy API Integration (waiting for approval)
When Etsy API key is approved:
- OAuth2 flow: GET /api/etsy/auth → redirect, GET /api/etsy/callback → save token
- POST /api/etsy/listings — create listing with title, description, tags, images
- Frontend: "Publish to Etsy" button in SEO Generator and Factory results

### ~~5. Bulk Upload in Factory~~ ✅ DONE
Completed: Raised image cap from 3 → 8. When >1 image uploaded, "Get AI Prompt" analyzes each image separately and adds all prompts as pre-selected variations ready to generate. Label updated.

### ~~6. Gallery — All Jobs View~~ ✅ DONE
Completed: Added GET /api/gallery/recent backend endpoint (latest 100 images across all workspace jobs). Added apiGallery.getRecent(). Added "All Images" shortcut at the top of the Gallery job history sidebar — loads all recent images when selected.

---

## 🟢 LOW PRIORITY

### ~~7. Overview Dashboard improvements~~ ✅ DONE
Completed:
- Thumbnail fix: removed `startsWith('http')` filter so local asset paths (assets/outputs/…) show as thumbnails. Frontend resolveUrl() handles local-path prefixing.
- Weekly chart: new WeeklyChart component showing last 7 days of images generated vs approved as a bar chart. Backend /api/dashboard now returns weeklyStats[].

### ~~8. Ideas Page~~ ✅ DONE
Completed: Fixed DesignJob created from ideas to include workspaceId (so jobs appear in job history). Added sort direction toggle (↑/↓). Added "Send All Approved" button for bulk factory dispatch. Added pending/approved counts in header.

### ~~9. Analytics Page~~ ✅ DONE
Completed: Fixed image thumbnails in analytics table (resolveUrl for local paths). "Scale Winner" button now links to Factory. Sort direction already present and working.

---

## ✅ COMPLETED
- Mockup Template Upload Tool (TemplateUploader.tsx with visual print area selector)
- Mockup Design Picker — Job History (auto-loads jobs, no manual ID entry)
- Download Button Fix in Mockups (blob download with descriptive filename)
- Bulk Upload in Factory (8 images, each analyzed separately → variations)
- Gallery All Jobs View (GET /api/gallery/recent + "All Images" sidebar entry)
- Overview Dashboard improvements (thumbnail fix + weekly bar chart)
- Ideas Page improvements (workspaceId fix, sort direction, bulk send, counters)
- Analytics Page improvements (image URL fix, Scale Winner links to Factory)
- Multi-provider Vision (Anthropic/Gemini/OpenAI)
- New Factory pipeline (Get AI Prompt + Variations)
- Multi-model generation (Flux, Ideogram, Recraft, Schnell)
- Style presets + prompt templates + negative prompt
- Factory results panel (BG remove + Upscale + SEO inline)
- Remove BG page (BiRefNet + Bria + Pixelcut)
- Upscale page (ESRGAN + Ideogram + AuraSR, 1x-8x)
- Gallery history + URL state persistence
- Overview thumbnails fixed
- Supabase migration
- SEO Generator with Live Etsy Data
- SEO Knowledge Base (auto weekly update + manual override)
- Download buttons (direct download + descriptive filenames)
- Etsy 2026 algorithm training in system prompt
