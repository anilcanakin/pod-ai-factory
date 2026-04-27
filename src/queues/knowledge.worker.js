const { Worker, UnrecoverableError } = require('bullmq');
const redisConnection = require('../config/redis');
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const ffmpeg = require('fluent-ffmpeg');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const prisma = require('../lib/prisma');

const TEMP_FRAME_DIR = path.join(__dirname, '../../temp_frames');
if (!fs.existsSync(TEMP_FRAME_DIR)) fs.mkdirSync(TEMP_FRAME_DIR, { recursive: true });

const CHUNK_SIZE = 1000;

// ─── Domain Classification ────────────────────────────────────────────────────
// Tags every knowledge chunk as one of four domains so the audit can apply
// category-specific rules instead of treating all memories the same.
const DOMAIN_KEYWORDS = {
    SEO:        /\b(title|tag|keyword|search|rank|algorithm|long.tail|cpc|seo|listing optim|etsy search|impressions|click.through|ctr)\b/i,
    VISUAL:     /\b(mockup|design|color|image|photo|thumbnail|visual|graphic|template|print|artwork|font|layout|background|canva|photoshop|resolution|dpi)\b/i,
    MANAGEMENT: /\b(price|pricing|shipping|cost|fee|order|inventory|profit|margin|customer|review|return|policy|budget|revenue|expense|refund|shop manager)\b/i,
    STRATEGY:   /\b(trend|niche|competition|competitor|market|research|growth|scal|holiday|seasonal|opportunity|viral|platform|audience|pinterest|tiktok|instagram|youtube|analytic)\b/i,
};

/**
 * Classifies a text chunk into one of: SEO | VISUAL | MANAGEMENT | STRATEGY
 * Uses keyword scoring (no API call). Falls back to STRATEGY if no signal.
 */
function _classifyDomain(content, sourceType = '') {
    // Source-type shortcuts — skip scoring for known types
    if (sourceType === 'SOCIAL_PROOF') return 'VISUAL';
    if (sourceType === 'EXPERT_PROOF') return 'STRATEGY';

    const scores = Object.entries(DOMAIN_KEYWORDS).map(([domain, rx]) => ({
        domain,
        matches: (content.match(new RegExp(rx.source, 'gi')) || []).length,
    }));
    scores.sort((a, b) => b.matches - a.matches);
    return scores[0].matches > 0 ? scores[0].domain : 'STRATEGY';
}

// ─── Agentic Knowledge — Strategic Rule Extraction ───────────────────────────
// Detects 2026 high-priority events in any rule text.
const HIGH_PRIORITY_EVENTS = /\b(4th of july|4 temmuz|independence day|250th|world cup|dünya kupası|fifa 2026|mother'?s day|anneler günü|father'?s day|babalar günü|halloween|christmas|noel|thanksgiving|şükran günü)\b/i;

// Maps the AI-facing Turkish/English category names → CorporateMemory domain values
const RULE_CATEGORY_MAP = {
    'SEO':       'SEO',
    'GÖRSEL':    'VISUAL',
    'TREND':     'STRATEGY',
    'FİYATLAMA': 'MANAGEMENT',
};

/**
 * Calls Claude Haiku to parse actionable strategic rules from raw content.
 * Returns { rules: [{category, rule, priority, evidence}] }
 */
async function _extractStrategicRules(content, sourceTitle) {
    const prompt = `Sen bir Etsy POD uzmanısın. Aşağıdaki içerikten YALNIZCA somut ve uygulanabilir stratejik kuralları çıkar.

KAYNAK: ${sourceTitle}
İÇERİK:
${content.slice(0, 8000)}

Her kuralı şu dört kategoriden birine ata:
• SEO       → title optimizasyonu, tag seçimi, keyword stratejisi, arama sıralaması
• GÖRSEL    → mockup kalitesi, renk paleti, tasarım ilkeleri, görsel kompozisyon
• TREND     → niş fırsatları, rakip analizi, mevsimsel etkinlikler, viral konular
• FİYATLAMA → fiyat stratejisi, kâr marjı, shipping maliyeti, rekabetçi fiyatlama

Kural 2026 etkinliklerine (4th of July 250th Anniversary, FIFA World Cup 2026, Mother's Day, Father's Day, Halloween, Christmas) atıfta bulunuyorsa priority:"HIGH" ver. Diğer tüm kurallara priority:"NORMAL".

Kural sayısı: en fazla 15. İçerikte kural yoksa boş dizi döndür.
SADECE JSON çıktısı ver, başka hiçbir metin ekleme:
{"rules":[{"category":"SEO|GÖRSEL|TREND|FİYATLAMA","rule":"<uygulanabilir kural — max 120 karakter>","priority":"HIGH|NORMAL","evidence":"<içerikten max 80 karakter alıntı>"}]}`;

    const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
    });

    const raw = response.content[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
    try { return JSON.parse(raw); } catch (_) {}
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
    return { rules: [] };
}

/**
 * Saves each extracted rule as a separate CorporateMemory row (type: STRATEGIC_RULE).
 * HIGH PRIORITY rules get "★ HIGH PRIORITY" in their title for easy filtering in the audit.
 */
async function _saveStrategicRules(rules, workspaceId, sourceTitle) {
    let saved = 0;
    for (const rule of rules) {
        const domain   = RULE_CATEGORY_MAP[rule.category] || 'STRATEGY';
        const isHigh   = rule.priority === 'HIGH' || HIGH_PRIORITY_EVENTS.test(rule.rule);
        const label    = isHigh ? ' ★ HIGH PRIORITY' : '';
        try {
            await prisma.corporateMemory.create({
                data: {
                    workspaceId,
                    type:     'STRATEGIC_RULE',
                    title:    `[${rule.category}${label}] ${rule.rule.slice(0, 100)}`,
                    content:  rule.rule,
                    category: domain,
                    isActive: true,
                    analysisResult: {
                        ruleCategory: rule.category,
                        domain,
                        priority:     isHigh ? 'HIGH' : 'NORMAL',
                        evidence:     rule.evidence || '',
                        sourceTitle,
                        extractedAt:  new Date().toISOString(),
                    },
                }
            });
            saved++;
        } catch (err) {
            console.warn(`[KnowledgeWorker] Kural kayıt hatası: ${err.message}`);
        }
    }
    return saved;
}

// ─── Robust YouTube ID Extractor ─────────────────────────────────────────────
// Tüm YouTube URL formatlarını destekler:
//   • youtube.com/watch?v=ID          (standart)
//   • youtu.be/ID                     (kısaltılmış)
//   • youtube.com/embed/ID            (gömülü)
//   • youtube.com/live/ID             (canlı yayın)
//   • youtube.com/shorts/ID           (Shorts)
//   • youtube.com/v/ID                (eski /v/ formatı)
//   • youtube.com/watch?...&v=ID      (ek parametreli)
//   • music.youtube.com/watch?v=ID    (YouTube Music)
const YT_ID_PATTERNS = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,               // watch?v= ve &v=
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,           // youtu.be/
    /youtube\.com\/(?:embed|live|shorts|v)\/([a-zA-Z0-9_-]{11})/, // embed/live/shorts/v
];

function extractVideoId(url) {
    if (!url || typeof url !== 'string') return null;
    for (const rx of YT_ID_PATTERNS) {
        const m = url.match(rx);
        if (m?.[1]) return m[1];
    }
    return null;
}

/**
 * YouTube video yayın tarihini sayfa HTML'inden çeker.
 * API key gerektirmez — ytInitialPlayerResponse JSON-LD'den okur.
 */
async function _fetchYouTubePublishDate(videoId) {
    try {
        const fetch = require('node-fetch');
        const res   = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
            headers: {
                'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            timeout: 8000,
        });
        const html = await res.text();

        // YouTube, tarihi "publishDate" veya "datePublished" alanında gömer
        const m = html.match(/"publishDate"\s*:\s*"([^"]+)"/)
               || html.match(/"datePublished"\s*:\s*"([^"]+)"/);
        return m ? m[1] : null; // örn. "2025-11-14"
    } catch (err) {
        console.warn(`[KnowledgeWorker] YouTube tarih çekme başarısız (${videoId}):`, err.message);
        return null;
    }
}

async function processKnowledge(job) {
    const { type, filePath, url, originalName, workspaceId = 'default-workspace' } = job.data;
    console.log(`[KnowledgeWorker] İşlenen tip: ${type} | JobID: ${job.id}`);

    let content = '';
    let metadata = { job_id: job.id, source_type: type };

    try {
        // ── Brain-specific types — use specialized services, bypass chunk-and-embed ──
        if (type === 'BRAIN_VIDEO') {
            const multimodalBrain = require('../services/multimodal-brain.service');
            const result = await multimodalBrain.analyzeVideoFull(
                workspaceId,
                filePath,
                job.data.title || originalName,
                job.data.videoType || 'training',
                job.data.category || null
            );
            console.log(`[KnowledgeWorker] ✓ BRAIN_VIDEO işlendi → memory id: ${result.memory?.id}`);
            if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
            return;
        }

        if (type === 'SOCIAL_PROOF') {
            const localBrainService = require('../services/brain.service');
            const memory = await localBrainService.ingestSocialProof(
                workspaceId,
                filePath,
                job.data.title || originalName
            );
            console.log(`[KnowledgeWorker] ✓ SOCIAL_PROOF işlendi → memory id: ${memory.id}`);
            if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
            return;
        }

        if (type === 'EXPERT_PROOF') {
            const localBrainService = require('../services/brain.service');
            const memory = await localBrainService.ingestExpertInsight(
                workspaceId,
                filePath,
                job.data.title || originalName
            );
            console.log(`[KnowledgeWorker] ✓ EXPERT_PROOF işlendi → memory id: ${memory.id}`);
            if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
            return;
        }

        // ── YouTube Smart: transcript → otomatik çoklu kategorize → ingestText ──
        if (type === 'YOUTUBE_SMART') {
            // ── 1. Video ID doğrulama — bozuk URL'yi anında işaretle, retry etme ──
            const videoId = extractVideoId(url);
            if (!videoId) {
                console.error(`[KnowledgeWorker] Bozuk URL Atlandı: ${url}`);
                throw new UnrecoverableError(`Bozuk URL Atlandı: ${url} — geçerli bir YouTube video URL'si değil`);
            }

            await job.updateProgress(10);

            // ── Deep Scavenger: API → yt-dlp auto-subs fallback ──────────────
            const { fetchTranscriptWithFallback } = require('../services/youtube.service');
            let transcript, transcriptSource;
            try {
                const result = await fetchTranscriptWithFallback(videoId, url);
                transcript      = result.transcript;
                transcriptSource = result.source;
                console.log(`[KnowledgeWorker] Transcript (${transcriptSource}): ${transcript.length} karakter`);
            } catch (fetchErr) {
                console.error(`[KnowledgeWorker] Transcript alınamadı: ${fetchErr.message}`);
                throw new UnrecoverableError(`Transcript bulunamadı: ${url} — ${fetchErr.message}`);
            }

            // ── Quality Check — sessiz / müzik / bilgisiz içerik tespiti ─────
            const NOISE_RX = /^\[?(music|müzik|applause|alkış|laughter|gülüş|noise|gürültü|♪|🎵|🎶)\]?$/i;
            const meaningfulWords = transcript.split(/\s+/).filter(w => w.length > 3 && !NOISE_RX.test(w));

            if (transcript.length < 150 || meaningfulWords.length < 20) {
                console.warn(`[KnowledgeWorker] Bilgi içermeyen içerik: ${url} (${transcript.length} kar, ${meaningfulWords.length} anlamlı kelime)`);
                await prisma.corporateMemory.create({
                    data: {
                        workspaceId,
                        type:     'YOUTUBE_SMART',
                        title:    `[Bilgi İçermeyen İçerik] ${originalName || url}`,
                        content:  'Bu video analiz edildi ancak işlenebilir metin içeriği bulunamadı. Muhtemelen müzik videosu veya sessiz içerik.',
                        category: 'MANAGEMENT',
                        isActive: false,
                        analysisResult: {
                            videoId, source: 'youtube', transcriptSource,
                            transcriptLength: transcript.length,
                            meaningfulWordCount: meaningfulWords.length,
                            reason: 'insufficient_content',
                            skippedAt: new Date().toISOString(),
                        },
                    }
                });
                throw new UnrecoverableError(`Bilgi İçermeyen İçerik: ${url} — transcript çok kısa veya yalnızca gürültü/müzik`);
            }

            // Video yayın tarihini çek (AI güvenilirlik skoru için)
            const videoPublishedAt = await _fetchYouTubePublishDate(videoId);
            if (videoPublishedAt) {
                console.log(`[KnowledgeWorker] Video tarihi: ${videoPublishedAt}`);
            }
            await job.updateProgress(30);

            // Claude Haiku — hangi kategoriler var tespit et, her biri için ayrı içerik çıkar
            const categorizationPrompt = `Sen Etsy POD uzmanısın. Aşağıdaki YouTube video transcript'ini analiz et.

Bu kategorilerden hangilerinde anlamlı içerik var, tespit et ve her biri için Türkçe madde madde bilgi çıkar:

Kategoriler:
- STRATEGY: iş stratejileri, niche seçimi, büyüme taktikleri, fiyatlandırma, kâr marjı, rakip analizi
- RULES: yasaklar, Etsy politikaları, risk içeren uygulamalar, kesinlikle yapılmaması gerekenler
- SEO_TACTICS: title formülleri, tag seçimi, long-tail keyword, arama sıralaması taktikleri, listing optimizasyonu
- SEO: genel SEO prensipleri, algoritma anlayışı, impressions/CTR iyileştirme
- VISUAL: tasarım ilkeleri, renk paleti, mockup kalitesi, görsel trendler, font seçimi
- MANAGEMENT: mağaza yönetimi, sipariş süreci, müşteri ilişkileri, zaman yönetimi, araç önerileri

Video: "${originalName || url}"

TRANSCRIPT:
${transcript.slice(0, 10000)}

KURALLAR:
- Yalnızca transcript'te gerçekten bahsedilen kategorileri dahil et — boş kategori ekleme
- Her madde maksimum 2 cümle, somut ve uygulanabilir
- Genel lafları ve tanıtım cümlelerini atla
- Türkçe yaz

SADECE aşağıdaki JSON formatında çıktı ver, başka hiçbir metin ekleme:
{"categories":[{"category":"STRATEGY","content":"## Başlık\\n- madde\\n- madde"},{"category":"RULES","content":"## Başlık\\n- madde"}]}`;

            const categRes = await anthropic.messages.create({
                model:      'claude-haiku-4-5-20251001',
                max_tokens: 2500,
                messages:   [{ role: 'user', content: categorizationPrompt }],
            });

            const rawJson = categRes.content[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
            let detectedCategories = [];
            try {
                const parsed = JSON.parse(rawJson);
                detectedCategories = (parsed.categories || []).filter(c => c.category && c.content && c.content.trim().length > 20);
            } catch (_) {
                // JSON parse başarısız — tek blok olarak STRATEGY'e kaydet
                detectedCategories = [{ category: 'STRATEGY', content: rawJson }];
            }

            console.log(`[KnowledgeWorker] ${detectedCategories.length} kategori tespit edildi: ${detectedCategories.map(c => c.category).join(', ')}`);
            await job.updateProgress(60);

            // Her kategori için ayrı ingestText çağrısı (video tarihi metadata olarak geçiyor)
            const { ingestText, detectAndResolveContradictions } = require('../services/knowledge.service');
            const videoMeta = { videoPublishedAt, videoId, source: 'youtube', transcriptSource };
            let totalChunks = 0;
            const allSavedEntries = [];

            for (const cat of detectedCategories) {
                const saved = await ingestText(
                    workspaceId,
                    `[YouTube] ${originalName || url} — ${cat.category}`,
                    cat.content,
                    cat.category,
                    videoMeta
                );
                totalChunks += saved.length;
                allSavedEntries.push(...saved.map(s => ({ ...s, category: cat.category, content: cat.content })));
            }
            console.log(`[KnowledgeWorker] ✓ YOUTUBE_SMART → ${totalChunks} chunk, ${detectedCategories.length} kategori kaydedildi`);
            await job.updateProgress(80);

            // Çelişki tespiti: yeni kayıtların eski kayıtlarla çelişip çelişmediğini kontrol et
            try {
                for (const entry of allSavedEntries) {
                    await detectAndResolveContradictions(
                        workspaceId,
                        entry.content,
                        entry.category,
                        entry.id
                    );
                }
            } catch (_) {}

            // Stratejik kurallar: tüm kategorilerin içeriğini birleştirerek çıkar
            try {
                const allContent = detectedCategories.map(c => c.content).join('\n\n');
                const { rules = [] } = await _extractStrategicRules(allContent, originalName || url);
                if (rules.length > 0) {
                    const saved2 = await _saveStrategicRules(rules, workspaceId, originalName || url);
                    console.log(`[KnowledgeWorker] ✓ ${saved2} stratejik kural ek olarak kaydedildi`);
                }
            } catch (_) {}

            await job.updateProgress(100);
            return;
        }

        if (type === 'FILE') {
            const ext = path.extname(filePath).toLowerCase();
            metadata.filename = originalName;

            if (ext === '.pdf') {
                const dataBuffer = fs.readFileSync(filePath);
                const pdf = require('pdf-parse');
                const pdfData = await pdf(dataBuffer);
                content = pdfData.text;
            } else if (['.mp4', '.mov', '.avi', '.mp3', '.wav'].includes(ext)) {
                content = await getMultimodalContent(filePath);
            } else if (ext === '.txt') {
                content = fs.readFileSync(filePath, 'utf-8');
            }
        } else if (type === 'YOUTUBE') {
            const legacyVideoId = extractVideoId(url);
            if (!legacyVideoId) {
                console.error(`[KnowledgeWorker] Bozuk URL Atlandı: ${url}`);
                throw new UnrecoverableError(`Bozuk URL Atlandı: ${url}`);
            }
            const { pathToFileURL } = require('url');
            const ytEsmPath = path.join(
                path.dirname(require.resolve('youtube-transcript/package.json')),
                'dist/youtube-transcript.esm.js'
            );
            const { YoutubeTranscript } = await import(pathToFileURL(ytEsmPath).href);
            let transcripts;
            try { transcripts = await YoutubeTranscript.fetchTranscript(legacyVideoId); }
            catch {
                throw new UnrecoverableError(`Transcript bulunamadı: ${url}`);
            }
            content = transcripts.map(t => t.text).join(' ');
            metadata.url = url;
            metadata.filename = 'YouTube Video';
        } else if (type === 'SOCIAL_MEDIA') {
            try {
                const fetch = (...args) => import('node-fetch').then(m => m.default(...args));
                const response = await fetch(url, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
                    signal: AbortSignal.timeout(15000),
                });
                const html = await response.text();
                content = html
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 15000);
                metadata.url = url;
                metadata.filename = originalName || url;
            } catch (fetchErr) {
                throw new UnrecoverableError(`Sayfa çekilemedi: ${url} — ${fetchErr.message}`);
            }
        } else if (type === 'RADAR_TREND') {
            try {
                const fetch = (...args) => import('node-fetch').then(m => m.default(...args));
                const response = await fetch(url, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
                    signal: AbortSignal.timeout(15000),
                });
                const html = await response.text();
                content = html
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 15000);
                metadata.url = url;
                metadata.filename = originalName || url;
                job.data.category = 'STRATEGY';
            } catch (fetchErr) {
                throw new UnrecoverableError(`Trend sayfası çekilemedi: ${url} — ${fetchErr.message}`);
            }
        }

        if (content.trim()) {
            const sourceTitle = originalName || url || 'Knowledge Entry';

            // Layer 1: Raw chunks for semantic search (RAG)
            await chunkAndEmbed(content, metadata, workspaceId, sourceTitle);

            // Layer 2: Structured strategic rules for audit (Agentic Knowledge)
            try {
                const { rules = [] } = await _extractStrategicRules(content, sourceTitle);
                if (rules.length > 0) {
                    const saved   = await _saveStrategicRules(rules, workspaceId, sourceTitle);
                    const highCnt = rules.filter(r => r.priority === 'HIGH' || HIGH_PRIORITY_EVENTS.test(r.rule)).length;
                    console.log(`[KnowledgeWorker] ✓ ${saved} stratejik kural kaydedildi (${highCnt} HIGH PRIORITY): ${sourceTitle}`);
                } else {
                    console.log(`[KnowledgeWorker] ℹ Kural çıkarılamadı (içerik yeterli değil): ${sourceTitle}`);
                }
            } catch (ruleErr) {
                // Rule extraction failure must NOT block the main job
                console.warn('[KnowledgeWorker] Kural çıkarma başarısız (ham chunk korunuyor):', ruleErr.message);
            }

            console.log(`[KnowledgeWorker] ✓ Başarıyla işlendi: ${sourceTitle}`);
        }

        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);

    } catch (err) {
        console.error(`[KnowledgeWorker] ✗ Hata: ${err.message}`);
        throw err;
    }
}

/**
 * Multimodal — Whisper transkripsiyon + Claude Vision (Gemini yerine)
 */
async function getMultimodalContent(filePath) {
    console.log(`[Multimodal] Video/Ses analiz ediliyor: ${path.basename(filePath)}`);
    const ext = path.extname(filePath).toLowerCase();
    const isVideo = ['.mp4', '.mov', '.avi'].includes(ext);

    const compressedAudioPath = path.join(TEMP_FRAME_DIR, `audio_${Date.now()}.mp3`);
    console.log('[Multimodal] Ses sıkıştırılıyor...');

    await new Promise((resolve, reject) => {
        ffmpeg(filePath)
            .noVideo()
            .audioCodec('libmp3lame')
            .audioBitrate('32k')
            .audioChannels(1)
            .save(compressedAudioPath)
            .on('end', resolve)
            .on('error', reject);
    });

    try {
        console.log('[Multimodal] Whisper transkripsiyon başlatıldı...');
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(compressedAudioPath),
            model: 'whisper-1',
        });

        let finalContent = `[SES AKTARIMI]: ${transcription.text}`;

        if (isVideo) {
            console.log('[Multimodal] Video kareleri yakalanıyor...');
            const frames = await extractFrames(filePath);

            console.log(`[Multimodal] ${frames.length} kare Claude Vision ile analiz ediliyor...`);
            const frameDescriptions = [];

            for (let i = 0; i < frames.length; i++) {
                const frameBase64 = fs.readFileSync(frames[i].path).toString('base64');
                try {
                    const response = await anthropic.messages.create({
                        model: 'claude-haiku-4-5-20251001',
                        max_tokens: 300,
                        messages: [{
                            role: 'user',
                            content: [
                                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: frameBase64 } },
                                { type: 'text', text: 'Analyze this frame from a POD/Etsy video. Describe metrics, settings, listings, or key information visible. Be concise.' }
                            ]
                        }]
                    });
                    frameDescriptions.push(`[Kare ${i + 1}]: ${response.content[0].text}`);
                } catch (err) {
                    console.warn(`[Multimodal] Kare ${i + 1} analizi başarısız:`, err.message);
                }
            }

            if (frameDescriptions.length > 0) {
                finalContent += `\n\n[GÖRSEL ANALİZ - TOPLU]:\n${frameDescriptions.join('\n')}`;
            }

            frames.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
        }

        return finalContent;
    } finally {
        if (fs.existsSync(compressedAudioPath)) fs.unlinkSync(compressedAudioPath);
    }
}

function extractFrames(videoPath) {
    return new Promise((resolve, reject) => {
        const frames = [];
        const baseName = Date.now();
        ffmpeg(videoPath)
            .screenshots({
                timestamps: ['10%', '30%', '50%', '70%', '90%'],
                folder: TEMP_FRAME_DIR,
                filename: `frame-${baseName}-%s.png`
            })
            .on('end', () => {
                const files = fs.readdirSync(TEMP_FRAME_DIR).filter(f => f.includes(`frame-${baseName}`));
                files.forEach(f => {
                    frames.push({ path: path.join(TEMP_FRAME_DIR, f), timestamp: 'N/A' });
                });
                resolve(frames);
            })
            .on('error', reject);
    });
}

/**
 * Metin chunk'larını embedding ile CorporateMemory'ye kaydet.
 * Eski Supabase etsy_knowledge tablosu yerine Prisma kullanılıyor.
 */
async function chunkAndEmbed(fullText, metadata, workspaceId = 'default-workspace', title = 'Knowledge Entry') {
    console.log(`[Brain] Chunk embedding başlıyor. Toplam karakter: ${fullText.length}, workspaceId: ${workspaceId}`);

    // workspace'in DB'de var olduğundan emin ol
    await prisma.workspace.upsert({
        where: { id: workspaceId },
        update: {},
        create: { id: workspaceId, name: 'Default Workspace', slug: workspaceId }
    });

    let chunkIndex = 0;
    for (let i = 0; i < fullText.length; i += CHUNK_SIZE) {
        const chunk = fullText.substring(i, i + CHUNK_SIZE);
        chunkIndex++;
        try {
            // Embedding oluştur (opsiyonel — başarısız olsa da kayıt yapılır)
            let vectorEmbedding = null;
            try {
                const embed = await openai.embeddings.create({
                    model: 'text-embedding-3-small',
                    input: chunk
                });
                vectorEmbedding = embed.data[0].embedding;
            } catch (embedErr) {
                console.warn(`[Brain] Chunk ${chunkIndex} embedding başarısız:`, embedErr.message);
            }

            // Domain sınıflandırması — SEO / VISUAL / MANAGEMENT / STRATEGY
            const domain = _classifyDomain(chunk, metadata.source_type);

            // CorporateMemory'ye kaydet
            const memory = await prisma.corporateMemory.create({
                data: {
                    workspaceId,
                    type: metadata.source_type === 'YOUTUBE' ? 'TEXT_NOTE' : 'TEXT_NOTE',
                    title: `${title} [Chunk ${chunkIndex}]`,
                    content: chunk,
                    category: domain,
                    analysisResult: { ...metadata, chunkIndex, domain, preview: chunk.substring(0, 100) },
                    ...(vectorEmbedding && { vectorEmbedding })
                }
            });
            console.log(`[Brain] Chunk ${chunkIndex} kaydedildi → id: ${memory.id}`);

        } catch (err) {
            console.error(`[Brain] Chunk ${chunkIndex} kayıt hatası (@${i}):`, err.message);
        }
    }
    console.log(`[Brain] Toplam ${chunkIndex} chunk işlendi.`);
}

const worker = new Worker('knowledge-ingestion', processKnowledge, {
    connection: redisConnection,
    concurrency: 1,
    lockDuration: 300000,
    lockRenewTime: 150000
});

console.log('[KnowledgeWorker] ✔  Kuyruk dinleniyor → knowledge-ingestion (LockDuration: 5m, Audio Compression: ON)');

module.exports = worker;
