/**
 * style.service.js — Style Orchestrator (Brand Kit)
 *
 * StyleProfile CRUD + prompt enjeksiyonu + FAL payload orchestrasyonu.
 *
 * Akış:
 *   1. Kullanıcı bir tasarımı beğenir → "Stile Kilitle" → createFromLockedDNA()
 *   2. Sonraki üretimlerde styleProfileId geçilir → applyToJobContext()
 *   3. applyToJobContext → promptu prefix/suffix ile sarar, sloganı yerleştirir
 *   4. Payload'a referenceImageUrl ve negativePrompt enjekte edilir
 */

const prisma = require('../lib/prisma');

// ─── CRUD ─────────────────────────────────────────────────────────────────────

async function listProfiles(workspaceId) {
    return prisma.styleProfile.findMany({
        where: { workspaceId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
}

async function getProfile(id, workspaceId) {
    return prisma.styleProfile.findFirst({ where: { id, workspaceId } });
}

async function createProfile(workspaceId, data) {
    return prisma.styleProfile.create({ data: { workspaceId, ...data } });
}

async function updateProfile(id, workspaceId, data) {
    const exists = await prisma.styleProfile.findFirst({ where: { id, workspaceId } });
    if (!exists) throw new Error('Profil bulunamadı');
    return prisma.styleProfile.update({ where: { id }, data });
}

async function deleteProfile(id, workspaceId) {
    const exists = await prisma.styleProfile.findFirst({ where: { id, workspaceId } });
    if (!exists) throw new Error('Profil bulunamadı');
    return prisma.styleProfile.delete({ where: { id } });
}

async function setDefault(id, workspaceId) {
    await prisma.styleProfile.updateMany({ where: { workspaceId }, data: { isDefault: false } });
    return prisma.styleProfile.update({ where: { id }, data: { isDefault: true } });
}

/**
 * "Stile Kilitle" → DB'ye kalıcı StyleProfile olarak kaydeder.
 * lockedDNA: { sourceTitle, modelKey, stylePresetId, seed, designBrief }
 */
async function createFromLockedDNA(workspaceId, lockedDNA) {
    const { MODEL_REGISTRY } = require('./batch-factory.service');
    const { getStylePreset }  = require('./style-manager.service');

    const model  = MODEL_REGISTRY[lockedDNA.modelKey]  || MODEL_REGISTRY.PREMIUM_GOOGLE;
    const preset = lockedDNA.stylePresetId ? getStylePreset(lockedDNA.stylePresetId) : null;

    return prisma.styleProfile.create({
        data: {
            workspaceId,
            name:             lockedDNA.sourceTitle?.slice(0, 80) || `Stil — ${new Date().toLocaleDateString('tr-TR')}`,
            emoji:            preset?.emoji || '🔒',
            baseModel:        model.id,
            promptSuffix:     preset?.promptFragment || null,
            negativePrompt:   null,
            referenceImageUrl: null,
            colorPalette:     preset?.colorPalette || null,
            sourcePresetId:   lockedDNA.stylePresetId  || null,
            sourceSeed:       lockedDNA.seed != null ? String(lockedDNA.seed) : null,
            isDefault:        false,
        }
    });
}

// ─── Prompt Orchestration ─────────────────────────────────────────────────────

/**
 * Sloganı FAL prompt'ına yerleştirir.
 * Model tipografide başarısızsa canvas-overlay ile üstüne yazılabilir
 * (bu fonksiyon sadece prompt katmanını hazırlar).
 */
function buildSloganInstruction(slogan) {
    if (!slogan?.trim()) return '';
    return `text on design: "${slogan.trim()}", bold sans-serif typography, large centered text, high contrast legible lettering, clear readable font`;
}

/**
 * Bir StyleProfile uygulayarak nihai FAL prompt'ını oluşturur.
 * Sıra: [prefix] → [basePrompt + sloganInstruction] → [suffix]
 */
function buildStyledPrompt(profile, basePrompt, slogan) {
    const parts = [];
    if (profile?.promptPrefix?.trim()) parts.push(profile.promptPrefix.trim());
    parts.push(basePrompt);
    const sloganPart = buildSloganInstruction(slogan);
    if (sloganPart) parts.push(sloganPart);
    if (profile?.promptSuffix?.trim()) parts.push(profile.promptSuffix.trim());
    return parts.join(', ');
}

/**
 * StyleProfile'ı FAL payload'ına enjekte eder.
 *   referenceImageUrl → payload.image_url   (style reference / IP-Adapter input)
 *   negativePrompt    → payload.negative_prompt (mevcut ile birleştirir)
 */
function injectIntoFalPayload(profile, payload) {
    if (!profile) return payload;
    const result = { ...payload };

    if (profile.referenceImageUrl) {
        result.image_url = profile.referenceImageUrl;
    }

    if (profile.negativePrompt?.trim()) {
        const existing = result.negative_prompt || '';
        result.negative_prompt = existing
            ? `${existing}, ${profile.negativePrompt.trim()}`
            : profile.negativePrompt.trim();
    }

    return result;
}

/**
 * batch-factory.service.js'ten çağrılır.
 * styleProfileId varsa DB'den çeker, promptu ve payload ekstralarını hazırlar.
 *
 * Dönüş:
 *   { finalPrompt, negativePrompt, referenceImageUrl, baseModel }
 */
async function applyToJobContext(workspaceId, { styleProfileId, basePrompt, slogan }) {
    let profile = null;
    if (styleProfileId) {
        profile = await getProfile(styleProfileId, workspaceId).catch(() => null);
    }

    const finalPrompt     = buildStyledPrompt(profile, basePrompt, slogan);
    const negativePrompt  = profile?.negativePrompt  || null;
    const referenceImageUrl = profile?.referenceImageUrl || null;
    const baseModel       = profile?.baseModel || null;

    return { finalPrompt, negativePrompt, referenceImageUrl, baseModel, profile };
}

module.exports = {
    listProfiles,
    getProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    setDefault,
    createFromLockedDNA,
    buildSloganInstruction,
    buildStyledPrompt,
    injectIntoFalPayload,
    applyToJobContext,
};
