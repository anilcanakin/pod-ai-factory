const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { OpenAI } = require('openai');
const { Queue } = require('bullmq');
const redisConnection = require('../config/redis');
const brainService = require('../services/multimodal-brain.service');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const knowledgeQueue = new Queue('knowledge-ingestion', { connection: redisConnection });

// Multer — video uploads up to 500MB
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(process.cwd(), 'assets', 'uploads', 'brain');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, `brain-${Date.now()}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 1000 * 1024 * 1024 } // 1GB (Ağır strateji videoları için)
});

// ─── GET /api/brain — List all corporate memories ─────────────────────────────
router.get('/', async (req, res) => {
    try {
        const memories = await prisma.corporateMemory.findMany({
            where: { isActive: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(memories);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── GET /api/brain/knowledge — Grouped knowledge entries ────────────────────
router.get('/knowledge', async (req, res) => {
    try {
        const all = await prisma.corporateMemory.findMany({
            where: { isActive: true },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                type: true,
                title: true,
                content: true,
                sourceUrl: true,
                analysisResult: true,
                createdAt: true
            }
        });

        // Group by source type
        const grouped = {
            video: all.filter(m => ['VIDEO_TUTORIAL', 'VIDEO_FULL'].includes(m.type)),
            text: all.filter(m => m.type === 'TEXT_NOTE'),
            auto: all.filter(m => !['VIDEO_TUTORIAL', 'VIDEO_FULL', 'TEXT_NOTE'].includes(m.type))
        };

        res.json({ entries: all, grouped, total: all.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── POST /api/brain/ingest-video — Legacy Gemini endpoint ───────────────────
router.post('/ingest-video', upload.single('video'), async (req, res) => {
    try {
        const { title, type, workspaceId } = req.body;
        const videoFile = req.file;

        if (!videoFile) return res.status(400).json({ error: 'No video file provided' });

        const memory = await brainService.processVideo(
            workspaceId || req.workspaceId || 'default-workspace',
            videoFile.path,
            title || videoFile.originalname,
            type || 'VIDEO_TUTORIAL'
        );

        res.json(memory);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── POST /api/brain/analyze-video — Enhanced Claude+Whisper analysis ────────
router.post('/analyze-video', upload.single('video'), async (req, res) => {
    try {
        const { title, videoType, workspaceId, category } = req.body;
        const videoFile = req.file;

        if (!videoFile) return res.status(400).json({ error: 'No video file provided' });

        const validTypes = ['training', 'meeting', 'etsy_update', 'tutorial'];
        const type = validTypes.includes(videoType) ? videoType : 'training';

        const result = await brainService.analyzeVideoFull(
            workspaceId || req.workspaceId || 'default-workspace',
            videoFile.path,
            title || videoFile.originalname.replace(/\.[^/.]+$/, ''),
            type,
            category || null
        );

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── POST /api/brain/add-text — Paste text directly into knowledge base ──────
router.post('/add-text', async (req, res) => {
    try {
        const { title, content, source, category } = req.body;
        const workspaceId = req.workspaceId || 'default-workspace';

        if (!title || !content) {
            return res.status(400).json({ error: 'title and content are required' });
        }

        const result = await brainService.addTextKnowledge(
            workspaceId,
            title,
            content,
            source || 'manual',
            category || null
        );

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── POST /api/brain/ingest-social — Social Media Intelligence ───────────
router.post('/ingest-social', upload.single('image'), async (req, res) => {
    try {
        const { title, workspaceId } = req.body;
        const imageFile = req.file;

        if (!imageFile) return res.status(400).json({ error: 'No image file provided' });

        const localBrainService = require('../services/brain.service');
        const memory = await localBrainService.ingestSocialProof(
            workspaceId || req.workspaceId || 'default-workspace',
            imageFile.path,
            title || `Social Proof - ${path.basename(imageFile.path)}`
        );

        res.json({
            message: 'Social intelligence captured successfully',
            memoryId: memory.id,
            analysis: memory.analysisResult
        });
    } catch (error) {
        console.error('[Brain Routes] Social Ingestion Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ─── POST /api/brain/ingest-expert — Expert Subscription Signals ──────────
router.post('/ingest-expert', upload.single('image'), async (req, res) => {
    try {
        const { title, workspaceId } = req.body;
        const imageFile = req.file;

        if (!imageFile) return res.status(400).json({ error: 'No image file provided' });

        const localBrainService = require('../services/brain.service');
        const memory = await localBrainService.ingestExpertInsight(
            workspaceId || req.workspaceId || 'default-workspace',
            imageFile.path,
            title || `Expert Insight - ${path.basename(imageFile.path)}`
        );

        res.json({
            message: 'Expert insight captured successfully',
            memoryId: memory.id,
            analysis: memory.analysisResult
        });
    } catch (error) {
        console.error('[Brain Routes] Expert Ingestion Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ─── POST /api/brain/test-knowledge — Q&A against stored knowledge ───────────
router.post('/test-knowledge', async (req, res) => {
    try {
        const { question } = req.body;
        if (!question) return res.status(400).json({ error: 'question required' });

        const workspaceId = req.workspaceId || 'default-workspace';
        const Anthropic = require('@anthropic-ai/sdk');
        const { getKnowledge } = require('../services/seo-knowledge.service');

        // 1. Generate embedding for the query using OpenAI text-embedding-3-small
        const embeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: question
        });
        const embedding = embeddingResponse.data[0].embedding;

        // 2. Semantic search via pgvector cosine similarity
        let memories;
        try {
            memories = await prisma.$queryRaw`
                SELECT id, type, title, content, category, "analysisResult",
                       1 - ("vectorEmbedding"::text::vector <=> ${JSON.stringify(embedding)}::vector) AS similarity
                FROM "CorporateMemory"
                WHERE "workspaceId" = ${workspaceId}
                  AND "isActive" = true
                  AND "vectorEmbedding" IS NOT NULL
                ORDER BY "vectorEmbedding"::text::vector <=> ${JSON.stringify(embedding)}::vector
                LIMIT 5
            `;
        } catch (pgErr) {
            // Fallback to recency-based search if pgvector is unavailable
            console.warn('[Brain] pgvector search failed, falling back to recency search:', pgErr.message);
            memories = await prisma.corporateMemory.findMany({
                where: { workspaceId, isActive: true },
                orderBy: { createdAt: 'desc' },
                take: 5
            });
        }

        const seoKnowledge = await getKnowledge(workspaceId);

        const knowledgeContext = memories
            .map(m => {
                const ar = m.analysisResult;
                const structured = ar?.synthesis
                    || (ar?.actionableRules?.map(r => `IF ${r.condition} THEN ${r.action}`).join('\n'))
                    || null;
                // YOUTUBE_SMART ve diğer kayıtlar içeriği doğrudan m.content'te saklar
                return structured || m.content || '';
            })
            .filter(Boolean)
            .join('\n\n---\n\n');

        const client = new Anthropic();
        const response = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1000,
            system: `Sen bir Etsy POD iş uzmanısın. Aşağıdaki bilgi tabanına dayanarak soruları yanıtla.
Bilgi tabanında ilgili bilgi varsa onu kullan; yoksa bunu açıkça belirt.
Yanıtların somut ve uygulanabilir olsun.
Bilgi tabanındaki Türkçe içerikleri de analiz et ve kullanıcıya Türkçe yanıt ver.
Sorunun dilinde yanıt ver (Türkçe soruysa Türkçe, İngilizce soruysa İngilizce).

BİLGİ TABANI (${memories.length} kayıt):
${knowledgeContext.slice(0, 4000)}

SEO BİLGİSİ:
${seoKnowledge.slice(0, 2000)}`,
            messages: [{ role: 'user', content: question }]
        });

        res.json({
            answer: response.content[0].text,
            sourcesUsed: memories.length,
            question,
            memories: memories.map(m => ({
                id: m.id,
                title: m.title,
                category: m.category,
                similarity: m.similarity != null ? Number(m.similarity) : null
            }))
        });
    } catch (err) {
        console.error('[Brain Test]', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/brain/queue-video — Queue single video for background analysis ─
// Returns immediately with jobId; processing happens in knowledge.worker.js
router.post('/queue-video', upload.single('video'), async (req, res) => {
    try {
        const { title, videoType, workspaceId, category } = req.body;
        const videoFile = req.file;
        if (!videoFile) return res.status(400).json({ error: 'No video file provided' });

        const validTypes = ['training', 'meeting', 'etsy_update', 'tutorial'];
        const job = await knowledgeQueue.add('brain-video', {
            type: 'BRAIN_VIDEO',
            filePath: videoFile.path,
            originalName: videoFile.originalname,
            title: title || videoFile.originalname.replace(/\.[^/.]+$/, ''),
            videoType: validTypes.includes(videoType) ? videoType : 'training',
            category: category || null,
            workspaceId: workspaceId || req.workspaceId || 'default-workspace'
        }, { attempts: 2, backoff: { type: 'exponential', delay: 5000 } });

        res.json({ jobId: job.id, message: 'Video queued for background analysis', name: videoFile.originalname });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── POST /api/brain/bulk-social — Queue multiple social images ───────────────
router.post('/bulk-social', upload.array('images', 50), async (req, res) => {
    try {
        const files = req.files;
        const workspaceId = req.workspaceId || req.body.workspaceId || 'default-workspace';
        if (!files || files.length === 0) return res.status(400).json({ error: 'No images provided' });

        const jobs = await Promise.all(files.map(f =>
            knowledgeQueue.add('brain-social', {
                type: 'SOCIAL_PROOF',
                filePath: f.path,
                originalName: f.originalname,
                title: `Social Trend: ${f.originalname}`,
                workspaceId
            }, { attempts: 2, backoff: { type: 'exponential', delay: 3000 } })
        ));

        res.json({ queued: jobs.length, jobIds: jobs.map(j => j.id), message: `${jobs.length} images queued for analysis` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── POST /api/brain/bulk-expert — Queue multiple expert images ───────────────
router.post('/bulk-expert', upload.array('images', 50), async (req, res) => {
    try {
        const files = req.files;
        const workspaceId = req.workspaceId || req.body.workspaceId || 'default-workspace';
        if (!files || files.length === 0) return res.status(400).json({ error: 'No images provided' });

        const jobs = await Promise.all(files.map(f =>
            knowledgeQueue.add('brain-expert', {
                type: 'EXPERT_PROOF',
                filePath: f.path,
                originalName: f.originalname,
                title: `Expert Strategy: ${f.originalname}`,
                workspaceId
            }, { attempts: 2, backoff: { type: 'exponential', delay: 3000 } })
        ));

        res.json({ queued: jobs.length, jobIds: jobs.map(j => j.id), message: `${jobs.length} images queued for analysis` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── GET /api/brain/summary — Knowledge base freshness indicator ──────────────
router.get('/summary', async (req, res) => {
    try {
        const { getKnowledgeSummary } = require('../services/knowledge-context.service');
        const summary = await getKnowledgeSummary(req.workspaceId || 'default-workspace');
        res.json(summary);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/brain/strategic-audit — Analyze rules → 3 winner niches ──────
router.post('/strategic-audit', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || 'default-workspace';
        const Anthropic = require('@anthropic-ai/sdk');

        // 1. Fetch all strategic rules for this workspace
        const rules = await prisma.corporateMemory.findMany({
            where: { workspaceId, type: 'STRATEGIC_RULE', isActive: true },
            orderBy: { createdAt: 'desc' },
            take: 60,
        });

        if (rules.length < 3) {
            return res.status(400).json({
                error: `En az 3 stratejik kural gerekli. Mevcut: ${rules.length}. Brain'e daha fazla video/belge yükle.`
            });
        }

        const rulesText = rules.map((r, i) => {
            const ar = r.analysisResult || {};
            const cat   = ar.ruleCategory || r.category || 'GENERAL';
            const ev    = ar.evidence     ? ` (kanıt: "${ar.evidence}")` : '';
            const pri   = ar.priority === 'HIGH' ? ' ★HIGH' : '';
            return `${i + 1}. [${cat}${pri}] ${r.content}${ev}`;
        }).join('\n');

        // 2. Claude Sonnet: analyze rules → 3 winner niches + slogans + prompts
        const client  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const prompt  = `Sen 2026 Etsy POD pazar uzmanısın. Aşağıdaki ${rules.length} adet stratejik kurala %100 uyan 3 adet "Winner Niş" belirle.

STRATEJİK KURALLAR:
${rulesText}

Seçim kriterleri:
• Her SEO, görsel, fiyatlandırma ve trend kuralına eksiksiz uymalı
• ★HIGH PRIORITY kurallar varsa o nişleri önceliklendir (2026 etkinlikleri: 4th of July 250th, FIFA World Cup, Mother's Day, Father's Day, Halloween, Christmas)
• Rekabetin orta/yüksek ama talebin daha yüksek olduğu nişler tercih et
• Her niş birbirinden tamamen farklı olmalı

Her niş için üret:
• 10 adet İngilizce t-shirt sloganı (max 8 kelime, baskıya uygun, güçlü)
• 10 adet görsel üretim promptu (Flux/Ideogram için, İngilizce, detaylı: stil + kompozisyon + renk + konu)

SADECE JSON döndür, başka metin ekleme:
{"winners":[{"niche":"Niche Name","nicheScore":97,"reason":"Neden tüm kurallara uyuyor (Türkçe, 2 cümle)","matchedRuleCount":${rules.length},"slogans":["s1","s2","s3","s4","s5","s6","s7","s8","s9","s10"],"visualPrompts":["p1","p2","p3","p4","p5","p6","p7","p8","p9","p10"]}]}`;

        const aiRes   = await client.messages.create({
            model:      'claude-sonnet-4-6',
            max_tokens: 5000,
            messages:   [{ role: 'user', content: prompt }],
        });

        const raw = aiRes.content[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
        let winners;
        try {
            winners = JSON.parse(raw).winners;
        } catch {
            const m = raw.match(/\{[\s\S]*\}/);
            if (m) winners = JSON.parse(m[0]).winners;
            else throw new Error('AI yanıtı parse edilemedi');
        }
        if (!Array.isArray(winners) || winners.length === 0) throw new Error('Winner niş üretilemedi');

        // 3. Save each winner as ACTION_CARD in CorporateMemory
        const savedCards = [];
        for (const w of winners.slice(0, 3)) {
            const card = await prisma.corporateMemory.create({
                data: {
                    workspaceId,
                    type:     'ACTION_CARD',
                    title:    `[ACTION CARD] ${w.niche}`,
                    content:  [
                        `Winner Niş: ${w.niche}`,
                        `Skor: ${w.nicheScore}/100`,
                        `Neden seçildi: ${w.reason}`,
                        '',
                        'SLOGANLAR:',
                        ...w.slogans.map((s, i) => `${i + 1}. ${s}`),
                        '',
                        'GÖRSEL PROMPTLAR:',
                        ...w.visualPrompts.map((p, i) => `${i + 1}. ${p}`),
                    ].join('\n'),
                    category: 'STRATEGY',
                    isActive: true,
                    tags:     ['action-card', 'winner', '2026', 'ready-to-produce'],
                    analysisResult: {
                        status:           'READY_TO_PRODUCE',
                        nicheName:        w.niche,
                        nicheScore:       w.nicheScore,
                        reason:           w.reason,
                        matchedRuleCount: w.matchedRuleCount || rules.length,
                        slogans:          w.slogans,
                        visualPrompts:    w.visualPrompts,
                        rulesAnalyzed:    rules.length,
                        generatedAt:      new Date().toISOString(),
                    },
                },
            });
            savedCards.push(card);
        }

        res.json({ success: true, count: savedCards.length, rulesAnalyzed: rules.length, cards: savedCards });
    } catch (err) {
        console.error('[Brain StrategicAudit]', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /api/brain/action-cards — List saved action cards ───────────────────
router.get('/action-cards', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || 'default-workspace';
        const cards = await prisma.corporateMemory.findMany({
            where: { workspaceId, type: 'ACTION_CARD', isActive: true },
            orderBy: { createdAt: 'desc' },
        });
        res.json(cards);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/brain/action-cards/:id/produce — Mark as IN_PRODUCTION + create Ideas ──
router.post('/action-cards/:id/produce', async (req, res) => {
    try {
        const { id } = req.params;
        const workspaceId = req.workspaceId || 'default-workspace';

        const card = await prisma.corporateMemory.findFirst({
            where: { id, workspaceId, type: 'ACTION_CARD' },
        });
        if (!card) return res.status(404).json({ error: 'Action Card bulunamadı' });

        const ar = card.analysisResult || {};
        if (!ar.slogans?.length) return res.status(400).json({ error: 'Slogan bulunamadı' });

        // Create Idea records from slogans so they appear in the Ideas page
        const ideas = await Promise.all(
            ar.slogans.map((slogan, i) =>
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
                    },
                })
            )
        );

        // Update card status
        await prisma.corporateMemory.update({
            where: { id },
            data: {
                analysisResult: {
                    ...ar,
                    status:   'IN_PRODUCTION',
                    sentAt:   new Date().toISOString(),
                    ideaIds:  ideas.map(i => i.id),
                },
            },
        });

        res.json({ success: true, nicheName: ar.nicheName, ideasCreated: ideas.length, ideaIds: ideas.map(i => i.id) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── DELETE /api/brain/:id — Soft-delete a memory ────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        await prisma.corporateMemory.update({
            where: { id: req.params.id },
            data: { isActive: false }
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── POST /api/brain/brainstorm — AI-Powered Product Idea Generator ──────────
router.post('/brainstorm', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || 'default-workspace';
        const { count = 3, focusNiche = '', season = '', excludeNiches = [] } = req.body || {};

        const { brainstorm } = require('../services/brainstorm.service');
        const result = await brainstorm(workspaceId, { count, focusNiche, season, excludeNiches });

        res.json(result);
    } catch (error) {
        console.error('[Brain] Brainstorm error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ─── POST /api/brain/brainstorm/update/:id — Re-score an Idea ───────────────
router.post('/brainstorm/update/:id', async (req, res) => {
    try {
        const workspaceId = req.workspaceId || 'default-workspace';
        const { updateIdea } = require('../services/brainstorm.service');
        const updatedAnalysisResult = await updateIdea(req.params.id, workspaceId);
        res.json({ success: true, updatedData: updatedAnalysisResult });
    } catch (error) {
        console.error('[Brain] Update Idea error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

