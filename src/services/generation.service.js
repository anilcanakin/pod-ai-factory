
const prisma = require('../lib/prisma');

const SUPPORTED_MODELS = {
    'fal-ai/flux/dev': {
        name: 'Flux 2 Dev',
        description: 'Versatile detail, best overall',
        speed: 'medium',
        strength: 'general'
    },
    'fal-ai/flux/schnell': {
        name: 'Flux Schnell',
        description: 'Same quality, 4x faster',
        speed: 'fast',
        strength: 'speed'
    },
    'fal-ai/ideogram/v3': {
        name: 'Ideogram 3.0',
        description: 'Best text & typography in images',
        speed: 'medium',
        strength: 'typography'
    },
    'fal-ai/recraft-v3': {
        name: 'Recraft V4',
        description: 'Vector-clean, perfect for screen print',
        speed: 'medium',
        strength: 'vector'
    },
    // ── Google GenAI provider ─────────────────────────────────────────────────
    'nano-banana': {
        name: 'Nano Banana 2',
        description: 'Google GenAI — nano-banana-2 model',
        speed: 'medium',
        strength: 'general',
        provider: 'google-genai'   // informational — routing handled by ImageRouter
    }
};

// Per-model cost map (USD per image) — based on FAL.ai pricing as of 2026
// FAL_COST_PER_IMAGE env var acts as a global override when set
const MODEL_COSTS = {
    'fal-ai/flux/dev':     0.030,  // Flux Dev  — high quality, ~$0.03/img
    'fal-ai/flux/schnell': 0.003,  // Flux Schnell — fast & cheap, ~$0.003/img
    'fal-ai/ideogram/v3':  0.080,  // Ideogram 3.0 — typography specialist, ~$0.08/img
    'fal-ai/recraft-v3':   0.040,  // Recraft V3 — vector/screen print, ~$0.04/img
    'nano-banana':         0.000,  // Google GenAI — pricing TBD / free tier
};
const FALLBACK_COST = 0.020; // used for unknown/new models

// ─── Model Router ────────────────────────────────────────────────────────────
// Kullanıcı dostu tier adlarını canonical provider endpoint'lerine çözer.
// FAL endpoint'leri → fal.provider.js | 'nano-banana' → google-genai.provider.js
// Gerçek yönlendirme ImageRouter (providers/image-router.js) tarafından yapılır.
const MODEL_TIER_MAP = {
    'fast':         'fal-ai/flux/schnell',  // hızlı & ucuz: $0.003/görsel
    'quality':      'fal-ai/flux/dev',      // kaliteli & detaylı: $0.030/görsel (default)
    'text':         'fal-ai/ideogram/v3',   // metin/tipografi uzmanı: $0.080/görsel
    'vector':       'fal-ai/recraft-v3',    // vektör & screen-print: $0.040/görsel
    'nano-banana':  'nano-banana',          // Google GenAI — nano-banana-2 (image-router tarafından çözülür)
};

/**
 * Tier adı ("fast", "quality"…) veya tam model ID ("fal-ai/flux/dev"…) kabul eder.
 * Her zaman çalıştırılabilir bir FAL endpoint ID'si döner.
 * @param {string} engineOrTier
 * @returns {string} FAL model ID
 */
function resolveModelId(engineOrTier) {
    if (!engineOrTier) return 'fal-ai/flux/dev';                 // default: quality
    if (MODEL_TIER_MAP[engineOrTier]) return MODEL_TIER_MAP[engineOrTier]; // tier → model
    if (SUPPORTED_MODELS[engineOrTier]) return engineOrTier;     // zaten geçerli model ID
    console.warn(`[ModelRouter] Bilinmeyen engine/tier: "${engineOrTier}" → default (quality) kullanılıyor`);
    return 'fal-ai/flux/dev';
}

function getModelCost(modelId) {
    if (process.env.FAL_COST_PER_IMAGE) {
        return parseFloat(process.env.FAL_COST_PER_IMAGE);
    }
    return MODEL_COSTS[modelId] ?? FALLBACK_COST;
}

// ─── Vision QA — FAL görselini Storage'a yazmadan önce kalite kontrolü ────────
// Davranış:
//   • OPENAI_API_KEY yoksa / 'your_...' placeholder'sa → QA tamamen atlanır (skipped)
//   • Key var ama API çökerse (429, network, timeout) → FAIL-CLOSED: hata fırlatılır,
//     generation durur. Bozuk görsel asla storage'a yazılmaz.
// Dönüş: { approved: boolean, reason: string|null, skipped: boolean }
const QA_SYSTEM_PROMPT = 'You are a Print-on-Demand Quality Assurance strict reviewer. Analyze this design. Check for: 1. Misspelled, garbled, or gibberish text. 2. Severe anatomical errors (e.g., extra fingers, fused limbs). 3. Unintended cropping. Respond strictly with a JSON object: { "approved": boolean, "reason": "string explaining why if rejected" }';

async function runVisionQA(imageUrl) {
    const apiKey = process.env.OPENAI_API_KEY;

    // Key hiç ayarlanmamışsa QA devre dışı — intentional bypass
    if (!apiKey || apiKey.length < 10 || apiKey.startsWith('your_')) {
        console.log('[VisionQA] QA atlandı: OPENAI_API_KEY yapılandırılmamış.');
        return { approved: true, reason: null, skipped: true };
    }

    // Key var → FAIL-CLOSED: herhangi bir hata tüm işlemi durdurur
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey });

    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 150,
        messages: [
            { role: 'system', content: QA_SYSTEM_PROMPT },
            {
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
                    { type: 'text', text: 'Analyze this POD design and return the JSON.' }
                ]
            }
        ]
    });

    const raw = response.choices[0].message.content.trim();
    const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    const result = JSON.parse(cleaned); // parse hatası da yukarı fırlar → fail-closed

    console.log(`[VisionQA] approved=${result.approved}${result.reason ? ' | reason: ' + result.reason : ''}`);
    return { approved: !!result.approved, reason: result.reason || null, skipped: false };
}

function imageSizeToAspectRatio(imageSize) {
    const map = {
        'square_hd': '1:1',
        'portrait_4_3': '3:4', 
        'landscape_4_3': '4:3'
    };
    return map[imageSize] || '1:1';
}

function buildModelInput(modelId, prompt, imageSize, negativePrompt = '') {
    const base = { prompt };

    // Google GenAI (nano-banana family) — only prompt is supported
    if (modelId.startsWith('nano-banana')) {
        return base;
    }

    if (modelId.includes('ideogram')) {
        return {
            ...base,
            aspect_ratio: imageSizeToAspectRatio(imageSize),
            style_type: 'DESIGN'
        };
    }
    
    if (modelId.includes('recraft')) {
        return {
            ...base,
            image_size: imageSize,
            style: 'vector_illustration',
            negative_prompt: negativePrompt || ''
        };
    }
    
    // Flux Schnell — negative_prompt desteklemiyor, max 4 adım
    if (modelId.includes('schnell')) {
        return {
            ...base,
            image_size: imageSize,
            num_inference_steps: 4,
        };
    }

    // Flux Dev default
    return {
        ...base,
        image_size: imageSize,
        num_inference_steps: 28,
        negative_prompt: negativePrompt || 'blurry, low quality, watermark, text, background, scenery'
    };
}

class GenerationService {
    SUPPORTED_MODELS = SUPPORTED_MODELS;

    async checkDailyCap(workspaceId, requestedCount) {
        if (!workspaceId) return; // Legacy jobs or dev mode (null workspace) have no cap

        const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
        const cap = workspace ? workspace.dailyImageCap : parseInt(process.env.DAILY_IMAGE_CAP || '200', 10);

        // Count images generated today for this workspace
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const generatedToday = await prisma.image.count({
            where: {
                job: { workspaceId },
                createdAt: { gte: startOfDay },
                status: 'COMPLETED'
            }
        });

        if (generatedToday + requestedCount > cap) {
            throw new Error(`CAP_REACHED: Cannot generate ${requestedCount} images. Daily cap is ${cap}, already generated ${generatedToday}.`);
        }
    }

    async runGeneration(jobId, engine = 'fal', count = 30, imageSize = 'square_hd', negativePrompt = '') {
        const imagesToGenerate = await prisma.image.findMany({
            where: {
                jobId: jobId,
                imageUrl: 'PENDING'
            },
            take: count
        });

        if (imagesToGenerate.length === 0) return [];

        const job = await prisma.designJob.findUnique({ where: { id: jobId } });
        await this.checkDailyCap(job.workspaceId, imagesToGenerate.length);

        const results = [];
        const falProvider  = require('./providers/fal.provider');
        const imageRouter  = require('./providers/image-router');
        const logService   = require('./log.service');

        // ── QA auto-retry sabiti ────────────────────────────────────────────────
        const MAX_QA_RETRIES = 3; // QA reddi başına maksimum yeniden üretim sayısı

        // attempts   = FAL 429 / network hatası için retry sayacı
        // qaAttempts = QA reddi için retry sayacı (her seferinde yeni seed)
        const processImageWithRetries = async (img, attempts = 0, qaAttempts = 0) => {
            try {
                const modelId = resolveModelId(img.engine);
                const modelCost = getModelCost(modelId);
                const payload = buildModelInput(modelId, img.promptUsed.substring(0, 1000), imageSize, negativePrompt);

                // ImageRouter normalises ALL providers → { image_url, seed, raw_response }
                // FAL models → fal.provider.js (CDN URL)
                // nano-banana → google-genai.provider.js (buffer staged to Supabase first)
                const falResponse = await imageRouter.generate(modelId, payload, job.workspaceId);

                // ── Vision QA: gümrük kapısı ───────────────────────────────────────
                // runVisionQA FAIL-CLOSED: key varsa herhangi bir hata throw eder → catch bloğuna düşer
                const qaResult = await runVisionQA(falResponse.image_url);

                if (!qaResult.skipped && !qaResult.approved) {
                    console.warn(`[VisionQA] Red (deneme ${qaAttempts + 1}/${MAX_QA_RETRIES}) imageId=${img.id}: ${qaResult.reason}`);

                    if (qaAttempts < MAX_QA_RETRIES - 1) {
                        // Yeni seed ile tekrar üret — FAL seed'i otomatik rastgeleleştirir
                        console.log(`[VisionQA] Auto-retry ${qaAttempts + 1} başlatılıyor (yeni seed)...`);
                        return processImageWithRetries(img, attempts, qaAttempts + 1);
                    }

                    // 3 denemede de başarısız → thumbnail'ı Supabase'e kaydet, REJECTED işaretle
                    console.error(`[VisionQA] ${MAX_QA_RETRIES} denemede onaylanamadı. imageId=${img.id}`);
                    let rejectedUrl = falResponse.image_url; // FAL URL geçici, aşağıda kalıcıyla değiştirilecek
                    try {
                        const { uploadRejectedToStorage } = require('./storage.service');
                        const storagePath = `rejected_assets/${img.id}_qa_thumb.jpg`;
                        rejectedUrl = await uploadRejectedToStorage(falResponse.image_url, storagePath);
                        console.log(`[VisionQA] Rejected thumbnail Supabase'e kaydedildi: ${rejectedUrl}`);
                    } catch (uploadErr) {
                        console.warn(`[VisionQA] Rejected thumbnail yüklenemedi (FAL URL kullanılıyor): ${uploadErr.message}`);
                    }

                    const totalCost = modelCost * MAX_QA_RETRIES; // her deneme ücretlendirildi
                    const rejected = await prisma.image.update({
                        where: { id: img.id },
                        data: {
                            imageUrl: rejectedUrl,
                            engine: modelId,
                            status: 'FAILED',
                            cost: totalCost,
                            rawResponse: `QA_REJECTED: ${qaResult.reason}`
                        }
                    });
                    return { success: false, img: rejected, error: `QA: ${qaResult.reason}`, qaRejected: true };
                }

                // ── Adım 1: RMBG — şeffaf PNG üret ───────────────────────────────
                // QA geçti → orijinal görseli direkt storage'a yazmadan önce
                // BiRefNet ile arka planı sil, şeffaf PNG'yi kaydet.
                let finalImageUrl = falResponse.image_url; // RMBG başarısız olursa fallback
                let rmbgCost = 0;
                let isTransparent = false;

                try {
                    const rmbgResult = await falProvider.removeBackground(
                        falResponse.image_url,
                        job.workspaceId
                    );
                    finalImageUrl  = rmbgResult.image_url;
                    rmbgCost       = rmbgResult.cost || 0;
                    isTransparent  = true;
                    console.log(`[Generation] RMBG ✓ → ${finalImageUrl.substring(0, 70)}...`);
                } catch (rmbgErr) {
                    // Non-fatal: BiRefNet geçici olarak çökmüşse orijinal görsel ile devam et.
                    // Uyarı açıkça loglanır — sessiz geçilmez.
                    console.warn(`[Generation] RMBG başarısız (orijinal görsel kullanılıyor, şeffaflık YOK): ${rmbgErr.message}`);
                }

                // ── Adım 2: Upscale — çözünürlük yükselt (Sprint 4 Eklentisi) ───────
                // Sadece RMBG başarılı olduysa ve şeffaf bir PNG'miz varsa upscale yapıyoruz.
                // Eğer upscale çökerse, işlem patlamasın (graceful degradation); 1024x1024 RMBG ile devam et.
                let upscaledCost = 0;
                if (isTransparent) {
                    try {
                        console.log(`[Generation] Upscale başlatılıyor (4x)...`);
                        const upscaleResult = await falProvider.upscaleImage(finalImageUrl, 4, job.workspaceId);
                        finalImageUrl = upscaleResult.image_url;
                        upscaledCost  = upscaleResult.cost || 0;
                        console.log(`[Generation] Upscale ✓ → ${finalImageUrl.substring(0, 70)}...`);
                    } catch (upscaleErr) {
                        console.warn(`[Generation] Upscale başarısız (RMBG görseli ile devam ediliyor): ${upscaleErr.message}`);
                    }
                }

                // ── Adım 3: Supabase'e kalıcı olarak yükle ────────────────────────
                // Upscale başarıldıysa devasa PNG, başarılamadıysa standart PNG/JPG
                let permanentUrl = finalImageUrl;
                try {
                    const { uploadUrlToStorage } = require('./storage.service');
                    const ext = isTransparent ? 'png' : 'jpg';
                    const storagePath = `generated/${img.id}_${Date.now()}.${ext}`;
                    permanentUrl = await uploadUrlToStorage(finalImageUrl, storagePath);
                    console.log(`[Generation] Supabase'e yüklendi (${ext.toUpperCase()}): ${permanentUrl}`);
                } catch (uploadErr) {
                    console.warn(`[Generation] Supabase upload başarısız, FAL/RMBG/Upscale URL kullanılıyor: ${uploadErr.message}`);
                }

                const totalCost = modelCost + rmbgCost + upscaledCost; // generation + RMBG + Upscale toplamı
                const updated = await prisma.image.update({
                    where: { id: img.id },
                    data: {
                        imageUrl: permanentUrl,
                        seed: falResponse.seed,
                        rawResponse: falResponse.raw_response,
                        engine: modelId,
                        status: 'COMPLETED',
                        cost: totalCost
                    }
                });

                // Mali kayıt — non-blocking, hata üretimi engellenmez
                if (job.workspaceId && totalCost > 0) {
                    const { recordExpense } = require('./finance.service');
                    recordExpense(job.workspaceId, {
                        imageId:     img.id,
                        jobId:       jobId,
                        amount:      totalCost,
                        provider:    'falai',
                        description: `${modelId.split('/').pop()} generation + RMBG + upscale`,
                    }).catch(() => {});
                }

                return { success: true, img: updated, cost: totalCost };

            } catch (err) {
                // FAL 429 rate limit → üstel bekleme ile tekrar dene
                if (err.message.includes('429') && attempts < 3) {
                    console.warn(`[RateLimit] image ${img.id} için yeniden deneniyor... (${2 ** attempts}s)`);
                    await new Promise(res => setTimeout(res, (2 ** attempts) * 1000));
                    return processImageWithRetries(img, attempts + 1, qaAttempts);
                }

                // VisionQA fail-closed hatası dahil her şey buraya düşer
                console.error(`[Generation] image ${img.id} başarısız:`, err.message);
                const failed = await prisma.image.update({
                    where: { id: img.id },
                    data: { status: 'FAILED', rawResponse: err.rawResponse || err.message }
                });
                return { success: false, img: failed, error: err.message };
            }
        };

        const chunkSize = parseInt(process.env.CHUNK_SIZE || '5', 10);
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < imagesToGenerate.length; i += chunkSize) {
            const chunk = imagesToGenerate.slice(i, i + chunkSize);
            const chunkResults = await Promise.all(chunk.map(img => processImageWithRetries(img)));

            chunkResults.forEach(res => {
                if (res.success) successCount++;
                else failCount++;
                results.push({ ...res.img, _cost: res.cost || 0 });
            });
        }

        // Emit Observability Log — sum actual per-model costs from results
        const totalCost = results.reduce((sum, r) => sum + (r?._cost || 0), 0);
        await logService.logEvent(jobId, 'GENERATION_DONE', failCount === 0 ? 'SUCCESS' : 'PARTIAL_SUCCESS', `Generated ${successCount}, Failed ${failCount}`, { successCount, failCount, costEstimate: parseFloat(totalCost.toFixed(4)) });

        await prisma.designJob.update({
            where: { id: jobId },
            data: { status: 'COMPLETED' }
        });

        return results;
    }
}
module.exports = Object.assign(new GenerationService(), { resolveModelId });
