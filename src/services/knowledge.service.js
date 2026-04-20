/**
 * Knowledge Service — RAG / Semantic Search Layer
 *
 * Mevcut knowledge.worker.js chunk+embed yazar. Bu servis OKUMA katmanını sağlar:
 *   getContextForAI()  — WPI/Scout prompt'larına enjekte edilecek context string
 *   searchSimilar()    — Cosine similarity ile en alakalı kayıtlar
 *   ingestText()       — Küçük metinler için doğrudan (kuyruğsuz) kayıt
 *
 * Storage: CorporateMemory.vectorEmbedding (Json? — float array)
 * Similarity: JS cosine (pgvector kurulumu gerekmez)
 */

const { OpenAI }       = require('openai');
const { PrismaClient } = require('@prisma/client');

const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const prisma  = new PrismaClient();

// ─── Config ────────────────────────────────────────────────────────────────────
const EMBED_MODEL    = 'text-embedding-3-small';
const CHUNK_SIZE     = 800;
const CHUNK_OVERLAP  = 100;
const SIM_THRESHOLD  = 0.30;   // min cosine similarity
const MAX_FETCH      = 500;    // DB'den çekilecek maksimum kayıt

// Academy kategorileri
const ACADEMY_CATEGORIES = ['STRATEGY', 'RULES', 'SEO_TACTICS', 'SEO', 'VISUAL', 'MANAGEMENT'];

// ─── Utilities ─────────────────────────────────────────────────────────────────

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

// ─── Embedding (OpenAI text-embedding-3-small) ─────────────────────────────────

async function embed(text) {
    const res = await openai.embeddings.create({
        model: EMBED_MODEL,
        input: text.slice(0, 8000),
    });
    return res.data[0].embedding;
}

// ─── Ingest (kuyruğsuz, küçük metinler için) ───────────────────────────────────

/**
 * Metni chunk'lar, embed eder ve CorporateMemory'ye kaydeder.
 * knowledge.routes.js /ingest-text endpoint'i tarafından çağrılır.
 *
 * @param {string} workspaceId
 * @param {string} title
 * @param {string} content
 * @param {'STRATEGY'|'RULES'|'SEO_TACTICS'} category
 */
async function ingestText(workspaceId, title, content, category = 'STRATEGY') {
    // Workspace upsert — güvenli
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
                tags:     [category.toLowerCase(), 'academy', 'manual'],
                analysisResult: {
                    source:      'academy_brain',
                    category,
                    chunkIndex:  i,
                    totalChunks: chunks.length,
                    ingestedAt:  new Date().toISOString(),
                },
                ...(vectorEmbedding ? { vectorEmbedding } : {}),
            },
        });
        saved.push(record);
        console.log(`[Knowledge] Chunk ${i + 1}/${chunks.length} kaydedildi → ${record.id}`);
    }

    return saved;
}

// ─── Semantic search ────────────────────────────────────────────────────────────

/**
 * Query embedding ile CorporateMemory kayıtlarına cosine similarity uygular.
 *
 * @param {string}   workspaceId
 * @param {string}   query        — doğal dil sorgusu
 * @param {object}   opts
 * @param {number}   opts.topK    — döndürülecek max kayıt sayısı
 * @param {string}   opts.category — belirli kategoriyle sınırla (opsiyonel)
 * @returns {Array}  En alakalı kayıtlar (score alanıyla)
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
            createdAt:       true,
        },
        take:    MAX_FETCH,
        orderBy: { createdAt: 'desc' },
    });

    const scored = records
        .map(r => ({
            ...r,
            score: _cosineSim(queryVec, Array.isArray(r.vectorEmbedding) ? r.vectorEmbedding : null),
        }))
        .filter(r => r.score > SIM_THRESHOLD)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

    return scored;
}

// ─── Context for AI prompts ─────────────────────────────────────────────────────

/**
 * WPI/Scout prompt'larına enjekte edilecek context string üretir.
 * Tüm kategoriler arasında arama yapar — RULES/SEO_TACTICS/STRATEGY öncelikli.
 *
 * @param {string} workspaceId
 * @param {string} query        — keyword veya ürün başlığı
 * @param {object} opts
 * @param {number} opts.maxChars — max karakter (token limiti için)
 * @param {number} opts.topK     — kaç kayıt
 * @returns {string}   Prompt'a enjekte edilecek metin (boş olabilir)
 */
async function getContextForAI(workspaceId, query, { maxChars = 1200, topK = 6 } = {}) {
    try {
        const results = await searchSimilar(workspaceId, query, { topK });
        if (!results.length) return '';

        const lines = results.map(r => {
            const tag = r.category ? `[${r.category}]` : '';
            return `${tag} ${r.content.slice(0, 200).replace(/\n+/g, ' ')}`;
        });

        return lines.join('\n').slice(0, maxChars);
    } catch (err) {
        console.warn('[Knowledge] getContextForAI hatası:', err.message);
        return '';
    }
}

module.exports = { embed, chunkText, ingestText, searchSimilar, getContextForAI, ACADEMY_CATEGORIES };
