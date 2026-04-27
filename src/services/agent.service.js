/**
 * agent.service.js — Agentic Workflow Orchestrator
 *
 * 4 aşamalı pipeline:
 *   1. Scout   → trendleri çek (DB'den veya canlı Google Trends)
 *   2. WPI     → listActionCards() — PENDING kartları al
 *   3. Brain   → zaten WPI içinde filtreli (confidence ≥ 80)
 *   4. SEO     → generateSeoPackage() ile paketle → packageStatus:'READY'
 *
 * Exports:
 *   runAgentPipeline(workspaceId, opts)  — adım 2-4'ü çalıştır (hızlı)
 *   triggerFullScan(workspaceId, opts)   — adım 1-4 tam döngü (yavaş, bg task)
 *   listAgentPackages(workspaceId)       — READY paketleri listele
 *   preparePackage(workspaceId, cardId)  — görsel üret + SEO döndür (one-click)
 */

const { PrismaClient } = require('@prisma/client');
const { listSuggestions, runScout } = require('./scout.service');
const { scan, listActionCards }     = require('./wpi.service');
const { generateSeoPackage }        = require('./seo.service');
const falProvider                   = require('./providers/fal.provider');
const { recordExpense }             = require('./finance.service');

const prisma = new PrismaClient();

// ─── Config ───────────────────────────────────────────────────────────────────
const PACKAGE_CONFIDENCE_MIN = 75; // WPI card confidence eşiği (agent'te biraz daha geniş)
const MAX_PACKAGES_PER_RUN   = 5;  // tek pipeline çalışmasında max paketleme
const SCOUT_KEYWORD_LIMIT    = 3;  // scout'tan kaç keyword WPI'a gidecek

// ─── Step 2-4: Process existing WPI cards → SEO → READY ──────────────────────

/**
 * Mevcut PENDING WPI_WINNER kartlarını SEO ile paketler.
 * Hızlı (~30s) — Apify scraping yok, sadece DB + Claude Haiku.
 *
 * @param {string} workspaceId
 * @param {{ forceRepackage?: boolean }} opts
 */
async function runAgentPipeline(workspaceId, { forceRepackage = false } = {}) {
    console.log('[Agent] 🤖 Pipeline başlatıldı…');

    // 2. Mevcut WPI PENDING kartları çek
    const pendingCards = await listActionCards(workspaceId, { status: 'PENDING', limit: 50 });

    // Zaten paketlenmiş olanları filtrele (forceRepackage yoksa)
    const toPackage = pendingCards
        .filter(c => {
            const isReady    = c.actionCard?.packageStatus === 'READY';
            const confidence = c.actionCard?.confidence ?? c.brainComparison?.confidence ?? 0;
            return (!isReady || forceRepackage) && confidence >= PACKAGE_CONFIDENCE_MIN;
        })
        .sort((a, b) => {
            const ca = a.actionCard?.confidence ?? a.brainComparison?.confidence ?? 0;
            const cb = b.actionCard?.confidence ?? b.brainComparison?.confidence ?? 0;
            return cb - ca; // yüksek confidence önce
        })
        .slice(0, MAX_PACKAGES_PER_RUN);

    if (toPackage.length === 0) {
        console.log('[Agent] Paketlenecek yeni kart yok.');
        return { packagesCreated: 0, message: 'Yeni kart yok. Önce WPI taraması başlat.' };
    }

    const packaged = [];
    for (const card of toPackage) {
        try {
            // 3. Academy Brain zaten WPI içinde filtredi, 4. SEO paketini üret
            const seo = await generateSeoPackage(card.id, workspaceId);

            // Kartı READY olarak güncelle
            const existing = await prisma.corporateMemory.findUnique({ where: { id: card.id } });
            if (!existing) continue;

            await prisma.corporateMemory.update({
                where: { id: card.id },
                data: {
                    analysisResult: {
                        ...(existing.analysisResult || {}),
                        packageStatus: 'READY',
                        seoPackage:    seo,
                        packagedAt:    new Date().toISOString(),
                    },
                },
            });

            packaged.push({
                id:         card.id,
                keyword:    card.keyword,
                confidence: card.actionCard?.confidence ?? card.brainComparison?.confidence,
            });
            console.log(`[Agent] ✓ Paket hazır: ${card.keyword} (${packaged.length}/${MAX_PACKAGES_PER_RUN})`);
        } catch (err) {
            console.warn(`[Agent] SEO paket hatası (${card.id}): ${err.message}`);
        }
    }

    return {
        packagesCreated: packaged.length,
        packages:        packaged,
        message:         `${packaged.length} hazır ilan paketi oluşturuldu.`,
    };
}

// ─── Step 1-4: Full Scout → WPI → SEO cycle (yavaş, bg) ─────────────────────

/**
 * Tam ajansal döngü:
 *   Scout → keyword çıkar → WPI scan → SEO paketleme
 * NOT: WPI scan Apify'ı çağırdığı için 2-5 dakika sürebilir.
 * Bu fonksiyon fire-and-forget olarak çağrılmalıdır.
 */
async function triggerFullScan(workspaceId, { forceScout = false } = {}) {
    console.log('[Agent] 🔭 Tam tarama başlatıldı…');

    // 1. Scout: taze trendler al
    let suggestions = await listSuggestions(workspaceId, 15);
    if (!suggestions.length || forceScout) {
        const scoutRes = await runScout(workspaceId);
        suggestions    = scoutRes.suggestions;
    }

    const keywords = suggestions
        .filter(s => s.keyword)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, SCOUT_KEYWORD_LIMIT)
        .map(s => s.keyword);

    if (!keywords.length) {
        return { error: 'Scout keyword bulunamadı', packagesCreated: 0 };
    }

    console.log(`[Agent] WPI taraması: ${keywords.join(', ')}`);

    // 2. WPI scan (kart kaydı dahil)
    const wpiResult = await scan(workspaceId, keywords, {
        saveWinners:   true,
        maxPerKeyword: 30,
    });

    // 3-4. Pipeline (yeni kartları SEO ile paketle)
    const pipelineResult = await runAgentPipeline(workspaceId);

    return {
        keywords,
        wpiSummary:     wpiResult.summary,
        packagesCreated: pipelineResult.packagesCreated,
        message:        `Tarama tamamlandı. ${pipelineResult.packagesCreated} paket hazır.`,
    };
}

// ─── List READY packages ───────────────────────────────────────────────────────

async function listAgentPackages(workspaceId, limit = 10) {
    const records = await prisma.corporateMemory.findMany({
        where: {
            workspaceId,
            type:     'WPI_WINNER',
            isActive:  true,
        },
        orderBy: { createdAt: 'desc' },
        take:    100,
    });

    return records
        .filter(r => r.analysisResult?.packageStatus === 'READY')
        .slice(0, limit)
        .map(r => {
            const ar  = r.analysisResult || {};
            const ac  = ar.actionCard    || {};
            const bc  = ar.brainComparison || {};
            return {
                id:               r.id,
                title:            r.title,
                keyword:          ar.keyword ?? '',
                confidence:       ac.confidence ?? bc.confidence ?? 0,
                priority:         ac.priority ?? 'NORMAL',
                hotNow:           ac.hotNow   ?? false,
                designSuggestion: ac.designSuggestion ?? bc.designSuggestion ?? '',
                competitiveEdge:  ac.competitiveEdge  ?? bc.competitiveEdge  ?? '',
                colorPalette:     ac.colorPalette      ?? bc.colorPalette     ?? '',
                targetKeywords:   ac.targetKeywords    ?? bc.targetKeywords   ?? [],
                designPrompt:     bc.designPrompt      ?? ac.designPrompt     ?? '',
                collection:       ac.collection        ?? null,
                event:            ac.event             ?? null,
                seoPackage: {
                    title:       ar.seoPackage?.title       ?? '',
                    description: ar.seoPackage?.description ?? '',
                    tags:        ar.seoPackage?.tags        ?? [],
                },
                product: {
                    title:      ar.product?.title    ?? '',
                    price:      ar.product?.price    ?? 0,
                    sales:      ar.product?.sales    ?? 0,
                    imageUrl:   ar.product?.imageUrl ?? null,
                    listingUrl: ar.product?.listingUrl ?? null,
                    shopName:   ar.product?.shopName  ?? '',
                },
                packagedAt: ar.packagedAt   ?? null,
                createdAt:  r.createdAt,
            };
        });
}

// ─── One-click prepare: generate image + return SEO ──────────────────────────

/**
 * WPI card'ından görsel üretir ve hazır SEO paketini döndürür.
 * Görsel DB'ye kaydedilmez — FAL CDN URL frontend'e döner (geçici, ~6 saat).
 *
 * @param {string} workspaceId
 * @param {string} cardId
 * @returns {{ imageUrl, seo, designPrompt, keyword }}
 */
async function preparePackage(workspaceId, cardId) {
    const record = await prisma.corporateMemory.findFirst({
        where: { id: cardId, workspaceId, type: 'WPI_WINNER' },
    });
    if (!record) throw new Error('Paket bulunamadı');

    const ar = record.analysisResult || {};
    const bc = ar.brainComparison   || {};
    const ac = ar.actionCard        || {};

    const designPrompt = bc.designPrompt || ac.designPrompt;
    if (!designPrompt) throw new Error('Bu kart için design prompt mevcut değil — WPI taramasından bir kart seçin.');

    // Flux Schnell: hızlı ($0.003) + POD kalitesi yeterli
    const falRes = await falProvider.generateImage(
        'fal-ai/flux/schnell',
        {
            prompt:               designPrompt.slice(0, 1000),
            image_size:           'square_hd',
            num_inference_steps:  4,
        },
        workspaceId
    );

    // Mali kayıt
    recordExpense(workspaceId, {
        amount:      0.003,
        provider:    'falai',
        description: `Agent preview: ${ar.keyword || cardId}`,
    }).catch(() => {});

    return {
        imageUrl:     falRes.image_url,
        designPrompt,
        keyword:      ar.keyword ?? '',
        seo: {
            title:       ar.seoPackage?.title       ?? '',
            description: ar.seoPackage?.description ?? '',
            tags:        ar.seoPackage?.tags        ?? [],
        },
        card: {
            id:              cardId,
            title:           record.title,
            confidence:      ac.confidence ?? bc.confidence ?? 0,
            colorPalette:    ac.colorPalette ?? bc.colorPalette ?? '',
            targetKeywords:  ac.targetKeywords ?? bc.targetKeywords ?? [],
        },
    };
}

module.exports = {
    runAgentPipeline,
    triggerFullScan,
    listAgentPackages,
    preparePackage,
};
