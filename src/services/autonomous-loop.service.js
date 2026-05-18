/**
 * autonomous-loop.service.js
 *
 * Tam otonom üretim döngüsü:
 * Yeni kurallar → Strategic Audit → ACTION_CARD → Ideas → Batch Factory
 * → BG Kaldır → Mockup → SEO → (opsiyonel) Etsy Auto-Publish
 */

const prisma   = require('../lib/prisma');
const Anthropic = require('@anthropic-ai/sdk');

const MIN_NEW_RULES      = 5;   // Audit tetikleme eşiği
const MAX_IDEAS_PER_CYCLE = 2;  // Döngü başına max fikir
const IMAGES_PER_IDEA    = 3;   // Fikir başına üretilecek görsel

// ─── Loop State (CorporateMemory ile saklanır) ────────────────────────────────

async function _getLoopState(workspaceId) {
    const entry = await prisma.corporateMemory.findFirst({
        where: { workspaceId, type: 'LOOP_STATE', isActive: true },
        orderBy: { createdAt: 'desc' },
    });
    return entry?.analysisResult || { lastRunAt: null, lastAuditAt: null, totalCycles: 0 };
}

async function _saveLoopState(workspaceId, state) {
    const existing = await prisma.corporateMemory.findFirst({
        where: { workspaceId, type: 'LOOP_STATE', isActive: true },
    });
    if (existing) {
        await prisma.corporateMemory.update({
            where: { id: existing.id },
            data:  { analysisResult: state, updatedAt: new Date() },
        });
    } else {
        await prisma.corporateMemory.create({
            data: {
                workspaceId,
                type:           'LOOP_STATE',
                title:          'Autonomous Loop State',
                content:        'Internal state tracker',
                category:       'MANAGEMENT',
                isActive:       true,
                analysisResult: state,
            },
        });
    }
}

// ─── Strategic Audit (brain.routes.js mantığı extract edildi) ─────────────────

async function _runStrategicAudit(workspaceId) {
    const rules = await prisma.corporateMemory.findMany({
        where:   { workspaceId, type: 'STRATEGIC_RULE', isActive: true },
        orderBy: { createdAt: 'desc' },
        take:    60,
    });

    if (rules.length < 3) {
        return { success: false, reason: `Yeterli stratejik kural yok (${rules.length}/3)`, cards: [] };
    }

    const rulesText = rules.map((r, i) => {
        const ar  = r.analysisResult || {};
        const cat = ar.ruleCategory || r.category || 'GENERAL';
        const pri = ar.priority === 'HIGH' ? ' ★HIGH' : '';
        const ev  = ar.evidence ? ` (kanıt: "${ar.evidence}")` : '';
        return `${i + 1}. [${cat}${pri}] ${r.content}${ev}`;
    }).join('\n');

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = `Sen 2026 Etsy POD pazar uzmanısın. Aşağıdaki ${rules.length} stratejik kurala %100 uyan 3 adet "Winner Niş" belirle.

STRATEJİK KURALLAR:
${rulesText}

Seçim kriterleri:
• Her SEO, görsel, fiyatlandırma ve trend kuralına eksiksiz uymalı
• ★HIGH PRIORITY kurallar varsa önceliklendir
• Rekabetin orta/yüksek ama talebin daha yüksek olduğu nişler tercih et
• Her niş birbirinden tamamen farklı olmalı

Her niş için üret:
• 5 adet İngilizce t-shirt sloganı (max 8 kelime, baskıya uygun, güçlü)
• 5 adet görsel üretim promptu (Flux/Ideogram için, İngilizce, detaylı)

SADECE JSON döndür:
{"winners":[{"niche":"Niche Name","nicheScore":97,"reason":"Neden seçildi (Türkçe, 1 cümle)","slogans":["s1","s2","s3","s4","s5"],"visualPrompts":["p1","p2","p3","p4","p5"]}]}`;

    const aiRes = await client.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 3000,
        messages:   [{ role: 'user', content: prompt }],
    });

    const raw = aiRes.content[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
    let winners;
    try {
        winners = JSON.parse(raw).winners;
    } catch {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) winners = JSON.parse(m[0]).winners;
        else throw new Error('Strategic Audit AI yanıtı parse edilemedi');
    }
    if (!Array.isArray(winners) || winners.length === 0) throw new Error('Winner niş üretilemedi');

    const savedCards = [];
    for (const w of winners.slice(0, 3)) {
        const card = await prisma.corporateMemory.create({
            data: {
                workspaceId,
                type:    'ACTION_CARD',
                title:   `[AUTO] ${w.niche}`,
                content: [
                    `Winner Niş: ${w.niche}`,
                    `Skor: ${w.nicheScore}/100`,
                    `Neden: ${w.reason}`,
                    '',
                    'SLOGANLAR:',
                    ...w.slogans.map((s, i) => `${i + 1}. ${s}`),
                    '',
                    'GÖRSEL PROMPTLAR:',
                    ...w.visualPrompts.map((p, i) => `${i + 1}. ${p}`),
                ].join('\n'),
                category: 'STRATEGY',
                isActive: true,
                tags:     ['auto-loop', 'action-card', '2026', 'ready-to-produce'],
                analysisResult: {
                    status:        'READY_TO_PRODUCE',
                    nicheName:     w.niche,
                    nicheScore:    w.nicheScore,
                    reason:        w.reason,
                    slogans:       w.slogans,
                    visualPrompts: w.visualPrompts,
                    rulesAnalyzed: rules.length,
                    generatedAt:   new Date().toISOString(),
                    source:        'autonomous-loop',
                },
            },
        });
        savedCards.push(card);
    }

    console.log(`[AutoLoop] ✓ Strategic Audit: ${savedCards.length} ACTION_CARD oluşturuldu`);
    return { success: true, cards: savedCards, rulesAnalyzed: rules.length };
}

// ─── ACTION_CARD → Ideas ───────────────────────────────────────────────────────

async function _produceCard(card, workspaceId) {
    const ar = card.analysisResult || {};
    if (!ar.slogans?.length) return [];

    const ideas = await Promise.all(
        ar.slogans.slice(0, 3).map(slogan =>
            prisma.idea.create({
                data: {
                    workspaceId,
                    niche:       ar.nicheName || card.title,
                    mainKeyword: slogan,
                    persona:     'POD Customer',
                    hook:        slogan,
                    iconFamily:  {},
                    styleEnum:   'minimalist',
                    status:      'READY_TO_PRODUCE',
                    marketScore: ar.nicheScore || 80,
                    marketData:  { source: 'autonomous-loop', cardId: card.id },
                },
            })
        )
    );

    await prisma.corporateMemory.update({
        where: { id: card.id },
        data:  { analysisResult: { ...ar, status: 'IN_PRODUCTION', sentAt: new Date().toISOString() } },
    });

    return ideas;
}

// ─── Ideas → Batch Factory ────────────────────────────────────────────────────

async function _queueBatch(idea, workspaceId) {
    const { Queue } = require('bullmq');
    const redis     = require('../config/redis');
    const batchQ    = new Queue('batch-setup', { connection: redis });

    const job = await prisma.designJob.create({
        data: {
            workspaceId,
            status:    'PENDING',
            mode:      'batch',
            keyword:   idea.mainKeyword,
            niche:     idea.niche,
            style:     'minimalist',
            autonomousLoop: true,
        },
    });

    // Image placeholder'ları oluştur
    const images = [];
    for (let i = 0; i < IMAGES_PER_IDEA; i++) {
        const img = await prisma.image.create({
            data: { jobId: job.id, workspaceId, engine: 'fal-ai/flux/schnell', imageUrl: '', status: 'PENDING', cost: 0 },
        });
        images.push(img.id);
    }

    await batchQ.add('batch-setup', {
        batchJobId:  job.id,
        workspaceId,
        niche:       idea.niche,
        count:       IMAGES_PER_IDEA,
        engine:      'fal-ai/flux/schnell',
        style:       idea.styleEnum || 'minimalist',
        mode:        'niche',
        autonomousLoop: true,
        ideaId:      idea.id,
    }, { attempts: 2, backoff: { type: 'exponential', delay: 5000 } });

    console.log(`[AutoLoop] ✓ Batch kuyruğa eklendi: "${idea.niche}" (jobId:${job.id})`);
    return job.id;
}

// ─── Post-Production: BG Kaldır + Mockup + SEO ───────────────────────────────

async function runPostProduction(batchJobId, workspaceId) {
    const { removeBackground } = require('./providers/fal.provider');
    const mockupRender         = require('./mockup-render.service');
    const seoService           = require('./seo.service');
    const { getSeoContext }    = require('./knowledge-context.service');

    console.log(`[AutoLoop] Post-production başladı → batchJobId:${batchJobId}`);

    // Tamamlanan görselleri çek
    const images = await prisma.image.findMany({
        where: { jobId: batchJobId, status: 'COMPLETED' },
    });

    if (!images.length) {
        console.warn(`[AutoLoop] Post-production: tamamlanan görsel yok (jobId:${batchJobId})`);
        return;
    }

    // Workspace'in ilk aktif şablonunu bul
    const template = await prisma.mockupTemplate.findFirst({
        where: { workspaceId, isActive: true },
        orderBy: { createdAt: 'asc' },
    });

    const job = await prisma.designJob.findUnique({ where: { id: batchJobId } });
    const keyword = job?.keyword || job?.niche || 'product';
    const seoContext = await getSeoContext(workspaceId).catch(() => '');

    for (const image of images) {
        try {
            // 1. Mockup render (şablon varsa)
            if (template) {
                const mockupResult = await mockupRender.renderMockup({
                    templateId:  template.id,
                    designImageUrl: image.imageUrl,
                    workspaceId,
                });

                if (mockupResult?.mockupUrl) {
                    await prisma.mockup.create({
                        data: { imageId: image.id, templateId: template.id, mockupUrl: mockupResult.mockupUrl },
                    });
                }
            }

            // 2. SEO üret
            const seo = await seoService.generateSEO(workspaceId, {
                keyword,
                niche:   job?.niche || keyword,
                context: seoContext,
            });

            if (seo?.title) {
                await prisma.sEOData.upsert({
                    where:  { imageId: image.id },
                    update: { title: seo.title, description: seo.description, tags: seo.tags },
                    create: { imageId: image.id, title: seo.title, description: seo.description, tags: seo.tags },
                });
            }

            // 3. Auto-publish kontrolü
            const settings = await _getLoopSettings(workspaceId);
            if (settings.autoPublish && seo?.title && template) {
                await _autoPublishToEtsy(image, seo, workspaceId);
            }

            console.log(`[AutoLoop] ✓ Post-production tamamlandı: imageId:${image.id}`);
        } catch (err) {
            console.warn(`[AutoLoop] Post-production hata (imageId:${image.id}):`, err.message);
        }
    }
}

async function _autoPublishToEtsy(image, seo, workspaceId) {
    try {
        const etsyService = require('./etsy-api.service');
        await etsyService.createDraftListing(workspaceId, {
            title:       seo.title,
            description: seo.description,
            tags:        seo.tags,
            imageUrl:    image.imageUrl,
            price:       process.env.DEFAULT_LISTING_PRICE || '19.99',
        });
        console.log(`[AutoLoop] ✓ Etsy'ye otomatik taslak oluşturuldu: imageId:${image.id}`);
    } catch (err) {
        console.warn(`[AutoLoop] Etsy auto-publish başarısız:`, err.message);
    }
}

// ─── Settings ────────────────────────────────────────────────────────────────

async function _getLoopSettings(workspaceId) {
    const entry = await prisma.corporateMemory.findFirst({
        where: { workspaceId, type: 'LOOP_SETTINGS', isActive: true },
    });
    return {
        autoPublish:   false,
        minNewRules:   MIN_NEW_RULES,
        maxIdeas:      MAX_IDEAS_PER_CYCLE,
        imagesPerIdea: IMAGES_PER_IDEA,
        enabled:       true,
        ...(entry?.analysisResult || {}),
    };
}

async function saveLoopSettings(workspaceId, settings) {
    const existing = await prisma.corporateMemory.findFirst({
        where: { workspaceId, type: 'LOOP_SETTINGS', isActive: true },
    });
    if (existing) {
        await prisma.corporateMemory.update({
            where: { id: existing.id },
            data:  { analysisResult: settings },
        });
    } else {
        await prisma.corporateMemory.create({
            data: {
                workspaceId,
                type:           'LOOP_SETTINGS',
                title:          'Autonomous Loop Settings',
                content:        'Loop configuration',
                category:       'MANAGEMENT',
                isActive:       true,
                analysisResult: settings,
            },
        });
    }
    return settings;
}

// ─── ANA DÖNGÜ ───────────────────────────────────────────────────────────────

async function runLoop(workspaceId) {
    const startedAt = new Date();
    console.log(`\n[AutoLoop] ══════════════════════════════`);
    console.log(`[AutoLoop] Döngü başladı → ${workspaceId}`);
    console.log(`[AutoLoop] ══════════════════════════════`);

    const settings = await _getLoopSettings(workspaceId);
    if (!settings.enabled) {
        console.log(`[AutoLoop] Devre dışı — atlandı`);
        return { skipped: true, reason: 'disabled' };
    }

    const state    = await _getLoopState(workspaceId);
    const since    = state.lastRunAt ? new Date(state.lastRunAt) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Yeni kural sayısını kontrol et
    const newRuleCount = await prisma.corporateMemory.count({
        where: { workspaceId, type: 'STRATEGIC_RULE', isActive: true, createdAt: { gte: since } },
    });

    console.log(`[AutoLoop] Yeni kural: ${newRuleCount} (eşik: ${settings.minNewRules})`);

    if (newRuleCount < settings.minNewRules) {
        const newState = { ...state, lastRunAt: startedAt.toISOString() };
        await _saveLoopState(workspaceId, newState);
        console.log(`[AutoLoop] Yeterli yeni kural yok — döngü atlandı`);
        return { skipped: true, reason: 'not_enough_new_rules', newRuleCount, threshold: settings.minNewRules };
    }

    // 1. Strategic Audit
    const auditResult = await _runStrategicAudit(workspaceId);
    if (!auditResult.success) {
        console.warn(`[AutoLoop] Audit başarısız: ${auditResult.reason}`);
        return { skipped: true, reason: auditResult.reason };
    }

    // 2. ACTION_CARD → Ideas + Batch
    const allIdeas = [];
    const batchJobIds = [];

    for (const card of auditResult.cards.slice(0, settings.maxIdeas)) {
        const ideas = await _produceCard(card, workspaceId);
        allIdeas.push(...ideas);

        // Her kart için bir toplu üretim başlat
        if (ideas.length > 0) {
            const batchJobId = await _queueBatch(ideas[0], workspaceId);
            batchJobIds.push(batchJobId);
        }
    }

    // 3. State güncelle
    const newState = {
        ...state,
        lastRunAt:    startedAt.toISOString(),
        lastAuditAt:  startedAt.toISOString(),
        totalCycles:  (state.totalCycles || 0) + 1,
        lastResult: {
            rulesAnalyzed: auditResult.rulesAnalyzed,
            cardsCreated:  auditResult.cards.length,
            ideasCreated:  allIdeas.length,
            batchJobIds,
        },
    };
    await _saveLoopState(workspaceId, newState);

    console.log(`[AutoLoop] ✅ Döngü tamamlandı`);
    console.log(`[AutoLoop]   Kural analiz: ${auditResult.rulesAnalyzed}`);
    console.log(`[AutoLoop]   ACTION_CARD:  ${auditResult.cards.length}`);
    console.log(`[AutoLoop]   Fikir:        ${allIdeas.length}`);
    console.log(`[AutoLoop]   Batch:        ${batchJobIds.length} kuyrukta`);
    console.log(`[AutoLoop] ══════════════════════════════\n`);

    return { success: true, ...newState.lastResult };
}

async function getLoopStatus(workspaceId) {
    const state    = await _getLoopState(workspaceId);
    const settings = await _getLoopSettings(workspaceId);

    const recentCards = await prisma.corporateMemory.findMany({
        where:   { workspaceId, type: 'ACTION_CARD', isActive: true },
        orderBy: { createdAt: 'desc' },
        take:    6,
        select:  { id: true, title: true, createdAt: true, analysisResult: true },
    });

    const totalRules = await prisma.corporateMemory.count({
        where: { workspaceId, type: 'STRATEGIC_RULE', isActive: true },
    });

    return { state, settings, recentCards, totalRules };
}

module.exports = { runLoop, runPostProduction, getLoopStatus, saveLoopSettings };
