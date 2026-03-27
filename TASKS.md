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
