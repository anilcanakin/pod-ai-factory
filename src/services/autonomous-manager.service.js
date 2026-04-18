const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const etsyBrowser = require('./etsy-browser.service');
const billingService = require('./billing.service');

const anthropic = require('../lib/anthropic');

const _geminiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || '';
const genAI = _geminiKey ? new GoogleGenerativeAI(_geminiKey) : null;

/**
 * Attempts JSON.parse first; if that fails, tries three repair strategies:
 * 1. Extract the first {...} block from the text (model added prose around JSON)
 * 2. Truncate at the last complete array item and close the object (truncated response)
 * 3. Return a safe fallback object so the audit never fully crashes
 */
function _repairAndParseJSON(raw) {
    // 1. Clean parse
    try { return JSON.parse(raw); } catch (_) {}

    // 2. Extract first {...} block
    const blockMatch = raw.match(/\{[\s\S]*\}/);
    if (blockMatch) {
        try { return JSON.parse(blockMatch[0]); } catch (_) {}

        // 3. Truncated array — find last complete object in "actions":[...]
        let repairable = blockMatch[0];
        // Close any unclosed array+object by trimming after the last complete }
        const lastClose = repairable.lastIndexOf('}');
        if (lastClose !== -1) {
            repairable = repairable.slice(0, lastClose + 1);
            // Ensure the actions array is closed
            if ((repairable.match(/\[/g) || []).length > (repairable.match(/\]/g) || []).length) {
                repairable += ']}';
            }
            // Ensure the root object is closed
            if ((repairable.match(/\{/g) || []).length > (repairable.match(/\}/g) || []).length) {
                repairable += '}';
            }
            try { return JSON.parse(repairable); } catch (_) {}
        }
    }

    // 4. Fallback — at least return a valid structure so caller doesn't crash
    console.warn('[Agent] JSON repair exhausted — returning fallback structure');
    return {
        executiveSummary: 'AI response could not be parsed. Raw output logged to console.',
        actions: [],
        _parseError: true,
        _rawSnippet: raw.slice(0, 300)
    };
}

// ─── Seasonal calendar — hardcoded dates relative to the audit run date ──────
// Updated annually; "windowDays" = how many days before the event to start pushing.
const SEASONAL_CALENDAR = [
    // ── Geçmiş / bitti (2026 başı) ──────────────────────────────────────────
    { name: "Sevgililer Günü",        date: "2026-02-14", status: "PAST" },
    { name: "St. Patrick's Day",      date: "2026-03-17", status: "PAST" },
    { name: "Paskalya",               date: "2026-04-05", status: "PAST" },
    // ── Yaklaşan / aktif ────────────────────────────────────────────────────
    { name: "Anneler Günü (ABD)",     date: "2026-05-10", status: "UPCOMING", windowDays: 30 },
    { name: "Babalar Günü (ABD)",     date: "2026-06-21", status: "UPCOMING", windowDays: 30 },
    { name: "4 Temmuz — 250. Yıl",   date: "2026-07-04", status: "UPCOMING", windowDays: 45 },
    { name: "FIFA Dünya Kupası 2026", date: "2026-06-11", status: "UPCOMING", windowDays: 60 },
    { name: "Halloween",              date: "2026-10-31", status: "UPCOMING", windowDays: 45 },
    { name: "Şükran Günü",           date: "2026-11-26", status: "UPCOMING", windowDays: 30 },
    { name: "Noel / Yılbaşı",        date: "2026-12-25", status: "UPCOMING", windowDays: 60 },
];

/**
 * Returns a human-readable seasonal context string to inject into the prompt.
 * Computed once per audit call using the real system date.
 */
function _buildSeasonalContext() {
    const now = new Date();
    const toDate = s => new Date(s);
    const diffDays = d => Math.round((toDate(d) - now) / 86400000);

    const past    = SEASONAL_CALENDAR.filter(e => e.status === 'PAST');
    const active  = SEASONAL_CALENDAR.filter(e => e.status === 'UPCOMING' && diffDays(e.date) >= 0 && diffDays(e.date) <= e.windowDays);
    const soon    = SEASONAL_CALENDAR.filter(e => e.status === 'UPCOMING' && diffDays(e.date) > e.windowDays && diffDays(e.date) <= 90);

    const fmt = e => `${e.name} (${e.date}${e.status === 'UPCOMING' ? ` — ${diffDays(e.date)} gün kaldı` : ''})`;

    return `
MEVSİMSEL FARKINDALIK (Bugünün tarihi: ${now.toISOString().slice(0, 10)}):
SEZONU GEÇEN ETKİNLİKLER → Bu ürünler/tasarımlar artık alakasız: ${past.map(e => e.name).join(', ')}.
ŞU AN AKTİF PENCERELER (hemen aksiyon al): ${active.length ? active.map(fmt).join(' | ') : 'Yok'}
YAKLAŞAN ETKİNLİKLER (önceden hazırlan): ${soon.length ? soon.map(fmt).join(' | ') : 'Yok'}

Seasonal Kurallar:
- Bir listing'in başlığı/açıklaması/tags'ı sezonu geçmiş bir etkinliğe (Sevgililer Günü, Paskalya vb.) odaklanıyorsa → actionType: "SEASONAL_PIVOT", reason içinde "CRITICAL: Out of Season" yaz ve yukarıdaki aktif/yaklaşan etkinliklerden birine geçiş öner.
- Aktif penceredeki bir etkinlik için mağazada listing yoksa → actionType: "NOTIFICATION", reason: "OPPORTUNITY: [etkinlik adı] için listing eksik".
- Yaklaşan büyük etkinlik (4 Temmuz 250. Yıl, FIFA Dünya Kupası) varsa → actionType: "NOTIFICATION" ile hazırlık hatırlatması yap.`;
}

/**
 * Builds the grouped knowledge-base block for the prompt.
 * memoriesByDomain = { HIGH_PRIORITY:[...], SEO:[...], VISUAL:[...], MANAGEMENT:[...], STRATEGY:[...], OTHER:[...] }
 * HIGH_PRIORITY section is always rendered first.
 */
function _buildKnowledgeBlock(memoriesByDomain) {
    const DOMAIN_ORDER  = ['HIGH_PRIORITY', 'SEO', 'VISUAL', 'MANAGEMENT', 'STRATEGY', 'OTHER'];
    const DOMAIN_LABELS = {
        HIGH_PRIORITY: '⚡ YÜKSEK ÖNCELİKLİ KURALLAR (2026 Etkinlikleri — Hemen Aksiyon Al)',
        SEO:           '📌 SEO KURALLARI',
        VISUAL:        '🎨 GÖRSEL / MOCKUP KURALLARI',
        MANAGEMENT:    '💰 FİYAT / YÖNETİM KURALLARI',
        STRATEGY:      '📊 STRATEJİ / NİŞ KURALLARI',
        OTHER:         '📋 DİĞER KURALLAR',
    };
    const lines = [];
    for (const domain of DOMAIN_ORDER) {
        const entries = memoriesByDomain[domain];
        if (!entries || !entries.length) continue;
        lines.push(DOMAIN_LABELS[domain] || domain);
        entries.forEach(e => lines.push(`  • ${e.title}`));
    }
    return lines.join('\n');
}

const AUDIT_PROMPT = (memoriesByDomain, stats, isMock = false, competitorSummary = '') => {
    const now = new Date();
    const todayStr = now.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

    const competitorBlock = competitorSummary
        ? `\n━━━ CANLI RAKİP VERİSİ (Apify Scraper) ━━━\n${competitorSummary}\n`
        : '';

    return `Sen üst düzey bir Etsy POD mağazasının CEO ve Mağaza Yöneticisisin.
${isMock ? '⚠ NOT: Canlı Etsy istatistikleri mevcut değil (tarayıcı oturumu açık değil). Aşağıdaki veriler MOCK/SİMÜLE veridir. Geçerli bir audit yapısı üret ancak tüm aksiyonları "PENDING_REAL_DATA" olarak işaretle.\n' : ''}
Sana şunları sunuyorum:
1. DOMAIN BAZLI STRATEJİK KURALLAR (SEO / Görsel / Yönetim / Strateji kategorilerinde ayrı ayrı).
2. CANLI PERFORMANS İSTATİSTİKLERİ (Listing başına Impressions, Visits, Orders).
3. MEVSİMSEL TAKVİM (Bugünün tarihine göre hesaplanmış).
${competitorSummary ? '4. CANLI RAKİP VERİSİ (Apify — gerçek zamanlı Etsy fiyat ve başlık analizi).' : ''}

━━━ DOMAIN BAZLI BİLGİ BANKASI ━━━
${_buildKnowledgeBlock(memoriesByDomain)}

━━━ CANLI İSTATİSTİKLER ━━━
${JSON.stringify(stats)}
${competitorBlock}
${_buildSeasonalContext()}

━━━ GÖREV ━━━
Her listing'i dört domain açısından ayrı ayrı değerlendir:
  [SEO]        → Title/tag/keyword kalitesi, arama görünürlüğü
  [VISUAL]     → Mockup kalitesi, görsel çekicilik; VISUAL_TRENDS verileriyle karşılaştır
  [MANAGEMENT] → Fiyatlandırma; CANLI RAKİP VERİSİ'ndeki ortalama/min/maks fiyatlarla karşılaştır
  [STRATEGY]   → Niş uyumu, mevsimsel fırsatlar, trend uyumu

${competitorSummary ? `RAKİP KARŞILAŞTIRMA KURALLARI:
  - Mağaza listing fiyatı > rakip ortalama fiyat ise → "OVERPRICED: Rakip ort. $X, mağaza $Y" yaz.
  - Mağaza listing fiyatı < rakip min fiyat × 0.8 ise → "UNDERPRICED: Değer altı fiyatlandırma" yaz.
  - VISUAL_TRENDS verisindeki renk/stil mağaza görselinden çok farklıysa → "VISUAL GAP: Trend gerisinde" yaz.\n` : ''}
En fazla 5 aksiyon kartı çıkar.
Önceliklendirme sırası:
  1. ⚡ HIGH PRIORITY kurallardan gelen aksiyonlar (2026 etkinlikleri)
  2. CRITICAL: Out of Season veya OVERPRICED/UNDERPRICED rakip uyarısı
  3. Düşük performanslı listing
  4. Fırsat bildirimleri

Her aksiyon kartı için "requiresApproval: true" ekle — kullanıcı her kartı Approve / Reject yapacak.
HIGH PRIORITY kuraldan gelen kartlara "priority: HIGH" ekle, diğerlerine "priority: NORMAL".
Rakip karşılaştırmasından gelen kartlara "competitorInsight" alanı ekle: örn. "Rakip ort: $18.50, senin fiyatın: $27.00".

━━━ DİL KURALLARI ━━━
- "executiveSummary" ve "reason" alanlarını MUTLAKA TÜRKÇE yaz.
- executiveSummary'nin başına bugünün tarihini (${todayStr}) ve aktif mevsimsel bağlamı ekle.
- CTR, SEO, Mockup, Tags, Impressions, Visits, Orders, Listing, POD teknik terimlerini çevirme.
- "CRITICAL: Out of Season", "OPPORTUNITY:", "HIGH PRIORITY" etiketlerini İngilizce bırak, geri kalanı Türkçe.

Yanıtı YALNIZCA bir JSON nesnesi olarak ver — önce veya sonra hiçbir açıklama, prose veya markdown ekleme:
{"executiveSummary":"<${todayStr} — 2-3 cümle Türkçe özet, aktif mevsimsel bağlam dahil>","actions":[{"listingId":"<id>","actionType":"UPDATE_PRICE|UPDATE_SEO|UPDATE_MOCKUP|SEASONAL_PIVOT|NOTIFICATION","domain":"SEO|VISUAL|MANAGEMENT|STRATEGY","priority":"HIGH|NORMAL","reason":"<kısa Türkçe gerekçe>","competitorInsight":"<rakip karşılaştırma verisi veya boş string>","requiresApproval":true,"details":{}}]}`;
};

/**
 * AutonomousManagerService
 * Manages the store based on corporate memories and live stats.
 * Provider chain: Claude Haiku (primary) → Gemini 1.5 Flash (fallback)
 */
class AutonomousManagerService {

    async _auditWithClaude(memoriesByDomain, stats, isMock, competitorSummary) {
        const response = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 2048,
            messages: [{ role: 'user', content: AUDIT_PROMPT(memoriesByDomain, stats, isMock, competitorSummary) }]
        });
        if (response.usage) {
            billingService.logUsage('anthropic', 'claude-haiku-4-5-20251001', response.usage, 'default-workspace', { feature: 'agent_audit' }).catch(() => {});
        }
        const raw = response.content[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
        return _repairAndParseJSON(raw);
    }

    async _auditWithGemini(memoriesByDomain, stats, isMock, competitorSummary) {
        if (!genAI) throw new Error('Gemini key not configured');
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const result = await model.generateContent(AUDIT_PROMPT(memoriesByDomain, stats, isMock, competitorSummary));
        if (result.response.usageMetadata) {
            billingService.logUsage('gemini', 'gemini-1.5-flash', result.response.usageMetadata, 'default-workspace', { feature: 'agent_audit_fallback' }).catch(() => {});
        }
        const raw = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        return _repairAndParseJSON(raw);
    }

    /**
     * runDailyAudit
     * Performs a full scan of the store and applies knowledge-based optimizations.
     */
    async runDailyAudit(workspaceId) {
        console.log(`[Agent] Starting daily store audit for workspace: ${workspaceId}`);

        try {
            // 1. Fetch Corporate Memory grouped by domain category
            const memoriesRaw = await prisma.corporateMemory.findMany({
                where: { workspaceId, isActive: true },
                select: { title: true, analysisResult: true, category: true }
            });

            // Group into domains; HIGH_PRIORITY is a cross-domain overlay
            const DOMAINS = ['SEO', 'VISUAL', 'MANAGEMENT', 'STRATEGY', 'OTHER'];
            const ALL_KEYS = ['HIGH_PRIORITY', ...DOMAINS];
            const memoriesByDomain = Object.fromEntries(ALL_KEYS.map(d => [d, []]));

            for (const m of memoriesRaw) {
                const cat = DOMAINS.includes(m.category?.toUpperCase()) ? m.category.toUpperCase() : 'OTHER';
                const entry = { title: m.title, analysisResult: m.analysisResult };

                // Add to its own domain bucket
                memoriesByDomain[cat].push(entry);

                // Also hoist to HIGH_PRIORITY bucket if flagged
                const isHigh = m.analysisResult?.priority === 'HIGH' || m.title?.includes('HIGH PRIORITY');
                if (isHigh) memoriesByDomain['HIGH_PRIORITY'].push(entry);
            }

            const domainCounts = ALL_KEYS.map(d => `${d}:${memoriesByDomain[d].length}`).join(' | ');
            console.log(`[Agent] Memories by domain — ${domainCounts}`);

            // 2. Fetch live stats from Etsy (falls back to mock data if not logged in)
            const { stats, success: statsSuccess, isMock, error: statsError } = await etsyBrowser.getListingStats();
            if (!statsSuccess) {
                console.warn(`[Agent] Live stats unavailable (${statsError}). Proceeding with mock data for audit structure.`);
            }
            if (isMock) {
                console.warn('[Agent] ⚠ Running audit on MOCK data — log in to Etsy once (BROWSER_HEADLESS=false) for real stats.');
            }

            // 3. Fetch live competitor data via Apify (best-effort — audit continues even if it fails)
            let competitorSummary = '';
            try {
                if (process.env.APIFY_API_KEY) {
                    console.log('[Agent] Fetching live competitor data via Apify...');
                    const apifyService = require('./apify.service');
                    // Extract keywords from the listing stats titles or use a default keyword
                    const keywords = stats
                        .slice(0, 3)
                        .map(s => s.title?.split(' ').slice(0, 3).join(' '))
                        .filter(Boolean);
                    if (keywords.length > 0) {
                        const ctx = await apifyService.fetchCompetitorContext(keywords);
                        competitorSummary = ctx.summary;
                        console.log(`[Agent] Competitor context fetched for: ${keywords.join(', ')}`);
                    }
                } else {
                    console.log('[Agent] APIFY_API_KEY not set — skipping competitor data.');
                }
            } catch (apifyErr) {
                console.warn(`[Agent] Apify competitor fetch failed (audit continues): ${apifyErr.message}`);
            }

            // 4. Consult AI Strategist — Claude primary, Gemini fallback
            let plan;
            try {
                console.log('[Agent] Consulting Claude Haiku (primary)...');
                plan = await this._auditWithClaude(memoriesByDomain, stats, isMock, competitorSummary);
            } catch (claudeErr) {
                console.warn(`[Agent] Claude failed (${claudeErr.message}), trying Gemini fallback...`);
                plan = await this._auditWithGemini(memoriesByDomain, stats, isMock, competitorSummary);
            }

            console.log(`[Agent] Audit complete. ${plan.actions?.length ?? 0} actions recommended.`);
            for (const action of (plan.actions || [])) {
                console.log(`[Agent] [${action.domain ?? '?'}] ${action.actionType} → ${action.reason}`);
            }

            return plan;
        } catch (error) {
            console.error('[Agent] Audit failed:', error);
            throw error;
        }
    }
}

module.exports = new AutonomousManagerService();
