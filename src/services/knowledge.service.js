/**
 * Knowledge Service — RAG / Semantic Search + Freshness + Contradiction Detection
 *
 *  ingestText()                 — chunk → embed → kaydet (publishedAt metadata destekli)
 *  searchSimilar()              — cosine sim × freshness × confidence ağırlıklı sıralama
 *  getContextForAI()            — prompt'a enjekte edilecek string (yaş etiketi dahil)
 *  detectAndResolveContradictions() — yeni bilgiyle çelişen eskileri devre dışı bırak
 *
 * Freshness ağırlıkları  (publishedAt veya createdAt'a göre):
 *   0–3 ay   → ×2.0   (çok taze)
 *   3–6 ay   → ×1.5
 *   6–12 ay  → ×1.0   (nötr)
 *   12–18 ay → ×0.7
 *   18+ ay   → ×0.4   (eski)
 *
 * Confidence decay: confidence = 0.85^(monthsOld/3)  — minimum 0.10
 * Entries with confidence < MIN_CONFIDENCE are excluded from context entirely.
 */

const { OpenAI }       = require('openai');
const { PrismaClient } = require('@prisma/client');
const Anthropic        = require('@anthropic-ai/sdk');

const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const prisma    = new PrismaClient();

// ─── Config ──────────────────────────────────────────────────────────────────
const EMBED_MODEL             = 'text-embedding-3-small';
const CHUNK_SIZE              = 800;
const CHUNK_OVERLAP           = 100;
const SIM_THRESHOLD           = 0.30;
const MAX_FETCH               = 500;
const CONTRADICTION_THRESHOLD = 0.78;  // cosine sim bu değerin üstündeyse çelişki kontrolü yap
const CONFIDENCE_DECAY        = 0.85;  // 3 aylık dönemde çarpan
const MIN_CONFIDENCE          = 0.10;  // bu değerin altında → context'e dahil etme

const ACADEMY_CATEGORIES = ['STRATEGY', 'RULES', 'SEO_TACTICS', 'SEO', 'VISUAL', 'MANAGEMENT'];

// ─── Freshness & Confidence ──────────────────────────────────────────────────

function _monthsAgo(dateStr) {
    if (!dateStr) return 0;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 0;
    return Math.max(0, (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30));
}

/** Kayıtın referans tarihi: publishedAt (video tarihi) → ingestedAt → createdAt */
function _refDate(entry) {
    const ar = entry.analysisResult || {};
    return ar.videoPublishedAt || ar.publishedAt || ar.ingestedAt || entry.createdAt;
}

function _computeConfidence(entry) {
    const months = _monthsAgo(_refDate(entry));
    return Math.max(MIN_CONFIDENCE, Math.pow(CONFIDENCE_DECAY, months / 3));
}

function _freshnessMultiplier(entry) {
    const months = _monthsAgo(_refDate(entry));
    if (months <= 3)  return 2.0;
    if (months <= 6)  return 1.5;
    if (months <= 12) return 1.0;
    if (months <= 18) return 0.7;
    return 0.4;
}

function _ageLabel(entry) {
    const months = Math.round(_monthsAgo(_refDate(entry)));
    if (months < 1)  return 'bu ay';
    if (months === 1) return '1ay';
    if (months < 12) return `${months}ay`;
    return `${Math.round(months / 12)}yıl`;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function _cosineSim(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na  += a[i] * a[i];
        nb  += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
        const chunk = text.slice(i, i + size);
        if (chunk.trim().length > 20) chunks.push(chunk);
        i += size - overlap;
    }
    return chunks;
}

async function embed(text) {
    const res = await openai.embeddings.create({
        model: EMBED_MODEL,
        input: text.slice(0, 8000),
    });
    return res.data[0].embedding;
}

// ─── Smart Display Title ──────────────────────────────────────────────────────

/**
 * Ham başlık + içerikten max 40 karakterlik okunabilir bir başlık üretir.
 * Kayıt UI'da bu displayTitle ile gösterilir — chunk numarası / URL görünmez.
 */
function _generateDisplayTitle(rawTitle, content) {
    // [YouTube] / kategori / chunk suffix temizle
    let t = rawTitle
        .replace(/^\[YouTube\]\s*/i, '')
        .replace(/\s*—\s*(STRATEGY|RULES|SEO_TACTICS|SEO|VISUAL|MANAGEMENT)\s*$/i, '')
        .replace(/\s*\[\d+\/\d+\]\s*$/i, '')
        .trim();

    // URL ise veya hâlâ çok uzunsa içerikten ilk anlamlı satırı al
    if (t.startsWith('http') || t.length > 60) {
        const firstLine = content
            .split('\n')
            .map(l => l.replace(/^#+\s*/, '').replace(/^[-*•]\s*/, '').trim())
            .find(l => l.length > 8 && !l.startsWith('http')) || t;
        t = firstLine;
    }

    // 40 karakterde kelime sınırında kes
    if (t.length > 40) {
        const cut = t.slice(0, 38).replace(/\s+\S*$/, '');
        t = (cut || t.slice(0, 38)) + '…';
    }

    return t;
}

// ─── Ingest ───────────────────────────────────────────────────────────────────

/**
 * @param {string} workspaceId
 * @param {string} title
 * @param {string} content
 * @param {string} category
 * @param {object} metadata  — { videoPublishedAt?, videoId?, source? }
 */
async function ingestText(workspaceId, title, content, category = 'STRATEGY', metadata = {}) {
    await prisma.workspace.upsert({
        where:  { id: workspaceId },
        update: {},
        create: { id: workspaceId, name: 'Default Workspace', slug: workspaceId },
    });

    const chunks = chunkText(content);
    const saved  = [];

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        let vectorEmbedding = null;
        try {
            vectorEmbedding = await embed(chunk);
        } catch (err) {
            console.warn(`[Knowledge] Embed hatası chunk ${i + 1}:`, err.message);
        }

        const record = await prisma.corporateMemory.create({
            data: {
                workspaceId,
                type:     'KNOWLEDGE_ENTRY',
                title:    chunks.length > 1 ? `${title} [${i + 1}/${chunks.length}]` : title,
                content:  chunk,
                category,
                isActive: true,
                tags:     [category.toLowerCase(), 'academy', metadata.source || 'manual'],
                analysisResult: {
                    source:           metadata.source || 'academy_brain',
                    category,
                    chunkIndex:       i,
                    totalChunks:      chunks.length,
                    ingestedAt:       new Date().toISOString(),
                    videoPublishedAt: metadata.videoPublishedAt || null,
                    videoId:          metadata.videoId || null,
                    displayTitle:     _generateDisplayTitle(title, chunk),
                },
                ...(vectorEmbedding ? { vectorEmbedding } : {}),
            },
        });
        saved.push(record);
    }

    console.log(`[Knowledge] ${chunks.length} chunk kaydedildi → ${title}`);
    return saved;
}

// ─── Contradiction Detection ──────────────────────────────────────────────────

/**
 * Yeni kaydedilen entry'lerle aynı kategorideki eski kayıtları karşılaştırır.
 * Gerçek çelişki varsa eskiyi devre dışı bırakır (isActive: false + OUTDATED tag).
 *
 * @param {string} workspaceId
 * @param {string} newContent    — yeni eklenen içerik (ilk chunk yeterli)
 * @param {string} category
 * @param {string} newEntryId    — yeni kaydın ID'si (kendisiyle kıyaslamamak için)
 */
async function detectAndResolveContradictions(workspaceId, newContent, category, newEntryId) {
    let queryVec;
    try {
        queryVec = await embed(newContent.slice(0, 1000));
    } catch (_) { return; }

    const existing = await prisma.corporateMemory.findMany({
        where: {
            workspaceId,
            isActive:  true,
            category,
            NOT: [{ id: newEntryId }, { vectorEmbedding: null }],
        },
        select: {
            id:              true,
            title:           true,
            content:         true,
            vectorEmbedding: true,
            analysisResult:  true,
            createdAt:       true,
            tags:            true,
        },
        take: MAX_FETCH,
    });

    const highSimilar = existing
        .map(r => ({
            ...r,
            score: _cosineSim(queryVec, Array.isArray(r.vectorEmbedding) ? r.vectorEmbedding : []),
        }))
        .filter(r => r.score > CONTRADICTION_THRESHOLD && r.content.length > 80)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

    if (highSimilar.length === 0) return;

    const comparePrompt = `Sen bir Etsy POD bilgi yönetimi asistanısın.

YENİ BİLGİ (${category}):
${newContent.slice(0, 500)}

ESKİ BİLGİLER:
${highSimilar.map((r, i) => `[${i}] ID:${r.id}\n${r.content.slice(0, 300)}`).join('\n---\n')}

GÖREV: Hangi ESKİ bilgiler, YENİ bilgiyle DOĞRUDAN ÇELİŞİYOR?
- Aynı konuya farklı bakış açısı → çelişki DEĞİL
- "X yapma" vs "X yap" gibi tam zıt tavsiye → çelişki
- Sadece gerçek, somut çelişkileri listele

SADECE JSON çıktısı ver:
{"contradicting":["id1","id2"]}`;

    let contradicting = [];
    try {
        const res = await anthropic.messages.create({
            model:      'claude-haiku-4-5-20251001',
            max_tokens: 200,
            messages:   [{ role: 'user', content: comparePrompt }],
        });
        const raw = res.content[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(raw);
        contradicting = parsed.contradicting || [];
    } catch (_) { return; }

    if (contradicting.length === 0) return;

    for (const id of contradicting) {
        try {
            const entry = await prisma.corporateMemory.findUnique({ where: { id } });
            if (!entry) continue;
            await prisma.corporateMemory.update({
                where: { id },
                data: {
                    isActive: false,
                    tags:     [...(entry.tags || []), 'OUTDATED'],
                    analysisResult: {
                        ...((entry.analysisResult) || {}),
                        outdatedBy: newEntryId,
                        outdatedAt: new Date().toISOString(),
                        reason:     'contradiction_detected',
                    },
                },
            });
            console.log(`[Knowledge] ⚠ Çelişen eski kayıt devre dışı: ${id}`);
        } catch (_) {}
    }

    console.log(`[Knowledge] Çelişki tespiti: ${contradicting.length} eski kayıt devre dışı bırakıldı`);
}

// ─── Semantic Search ──────────────────────────────────────────────────────────

/**
 * Freshness × Confidence × Cosine similarity ile sıralar.
 * MIN_CONFIDENCE altındaki kayıtlar döndürülmez.
 */
async function searchSimilar(workspaceId, query, { topK = 6, category = null } = {}) {
    let queryVec;
    try {
        queryVec = await embed(query);
    } catch (err) {
        console.warn('[Knowledge] Query embed hatası:', err.message);
        return [];
    }

    const where = { workspaceId, isActive: true, NOT: { vectorEmbedding: null } };
    if (category) where.category = category;

    const records = await prisma.corporateMemory.findMany({
        where,
        select: {
            id:              true,
            title:           true,
            content:         true,
            category:        true,
            type:            true,
            vectorEmbedding: true,
            analysisResult:  true,
            createdAt:       true,
        },
        take:    MAX_FETCH,
        orderBy: { createdAt: 'desc' },
    });

    const scored = records
        .map(r => {
            const cosine     = _cosineSim(queryVec, Array.isArray(r.vectorEmbedding) ? r.vectorEmbedding : []);
            const confidence = _computeConfidence(r);
            const freshness  = _freshnessMultiplier(r);
            return { ...r, score: cosine * freshness * confidence, confidence, freshness };
        })
        .filter(r => r.score > SIM_THRESHOLD && r.confidence >= MIN_CONFIDENCE)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

    return scored;
}

// ─── Context for AI Prompts ───────────────────────────────────────────────────

/**
 * Prompt'a enjekte edilecek string.
 * Her satırda kategori + yaş etiketi var: "[RULES][3ay] ..."
 */
async function getContextForAI(workspaceId, query, { maxChars = 1200, topK = 6 } = {}) {
    try {
        const results = await searchSimilar(workspaceId, query, { topK });
        if (!results.length) return '';

        const lines = results.map(r => {
            const cat = r.category ? `[${r.category}]` : '';
            const age = `[${_ageLabel(r)}]`;
            return `${cat}${age} ${r.content.slice(0, 200).replace(/\n+/g, ' ')}`;
        });

        return lines.join('\n').slice(0, maxChars);
    } catch (err) {
        console.warn('[Knowledge] getContextForAI hatası:', err.message);
        return '';
    }
}

module.exports = {
    embed,
    chunkText,
    ingestText,
    searchSimilar,
    getContextForAI,
    detectAndResolveContradictions,
    ACADEMY_CATEGORIES,
};
