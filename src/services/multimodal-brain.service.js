const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');
const { OpenAI } = require('openai');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateEmbedding(text) {
    try {
        const response = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: text.slice(0, 8191) // token limit guard
        });
        return response.data[0].embedding;
    } catch (err) {
        console.warn('[Brain] Embedding generation failed:', err.message);
        return null;
    }
}

function detectCategory(synthesis) {
    const text = synthesis.toLowerCase();
    if (text.includes('digital') || text.includes('printable') || text.includes('download'))
        return 'digital_products';
    if (text.includes('algorithm') || text.includes('ranking') || text.includes('search'))
        return 'etsy_algorithm';
    if (text.includes('tag') || text.includes('title') || text.includes('seo') || text.includes('keyword'))
        return 'seo_tips';
    if (text.includes('niche') || text.includes('trend') || text.includes('market'))
        return 'niche_research';
    if (text.includes('shirt') || text.includes('hoodie') || text.includes('apparel') || text.includes('pod') || text.includes('print'))
        return 'pod_apparel';
    return 'general_etsy';
}

class MultimodalBrainService {
    constructor() {
        this.tempDir = path.join(process.cwd(), 'assets', 'temp_brain');
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    // ─── Shared Utilities ─────────────────────────────────────────────────────

    async extractFrames(videoPath, sessionId) {
        const sessionDir = path.join(this.tempDir, sessionId);
        if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir);

        return new Promise((resolve, reject) => {
            ffmpeg(videoPath)
                .on('end', () => {
                    const frames = fs.readdirSync(sessionDir).map(f => path.join(sessionDir, f));
                    resolve(frames);
                })
                .on('error', (err) => reject(err))
                .screenshots({
                    count: 10,
                    folder: sessionDir,
                    size: '1280x720'
                });
        });
    }

    // ─── Legacy endpoint (Gemini-based, kept for /ingest-video backward compat) ─

    async processVideo(workspaceId, videoPath, title, type = 'VIDEO_TUTORIAL') {
        const sessionId = Date.now().toString();
        console.log(`[Brain] Starting Gemini digestion for: ${title}`);

        try {
            const frames = await this.extractFrames(videoPath, sessionId);
            const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

            const imageParts = frames.map(framePath => ({
                inlineData: {
                    data: Buffer.from(fs.readFileSync(framePath)).toString('base64'),
                    mimeType: 'image/jpeg'
                }
            }));

            const prompt = `
You are an expert Etsy Shop Manager & POD Strategist.
I am providing you with screenshots from a video titled: "${title}".

TASK:
1. Analyze the visual information (UI settings, charts, actions).
2. Extract actionable "IF-THEN" rules.
3. Identify any specific UI elements or settings mentioned.

OUTPUT FORMAT (JSON only, no markdown):
{
  "summary": "Short overview",
  "actionableRules": [{ "condition": "IF...", "action": "THEN...", "rationale": "Why?" }],
  "uiInsights": [{ "element": "element name", "recommendation": "recommendation text" }],
  "strategicNotes": ["tip1", "tip2"]
}`;

            const result = await model.generateContent([prompt, ...imageParts]);
            let text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
            const analysis = JSON.parse(text);

            const embeddingText = `${title} ${analysis.summary}`;
            const vectorEmbedding = await generateEmbedding(embeddingText);

            const memory = await prisma.corporateMemory.create({
                data: {
                    workspaceId,
                    type,
                    title,
                    content: analysis.summary,
                    analysisResult: { ...analysis, sourceType: 'gemini_video' },
                    sourceUrl: videoPath,
                    ...(vectorEmbedding && { vectorEmbedding })
                }
            });

            fs.rmSync(path.join(this.tempDir, sessionId), { recursive: true, force: true });
            return memory;
        } catch (error) {
            console.error('[Brain] Gemini processing error:', error);
            throw error;
        }
    }

    // ─── Enhanced Claude-based Analysis ───────────────────────────────────────

    async analyzeVideoFull(workspaceId, videoPath, title, videoType = 'training', categoryOverride = null) {
        const tmpDir = path.join(os.tmpdir(), `brain-${Date.now()}`);
        fs.mkdirSync(tmpDir, { recursive: true });

        const framesDir = path.join(tmpDir, 'frames');
        fs.mkdirSync(framesDir);

        console.log(`[Brain] Starting full Claude analysis for: ${title}`);

        try {
            // 1. Extract 20 frames spread across video
            await new Promise((resolve, reject) => {
                ffmpeg(videoPath)
                    .screenshots({
                        count: 20,
                        folder: framesDir,
                        filename: 'frame-%i.jpg',
                        size: '1280x720'
                    })
                    .on('end', resolve)
                    .on('error', reject);
            });

            // 2. Extract audio track
            const audioPath = path.join(tmpDir, 'audio.mp3');
            await new Promise((resolve) => {
                ffmpeg(videoPath)
                    .output(audioPath)
                    .audioCodec('libmp3lame')
                    .on('end', resolve)
                    .on('error', (err) => {
                        console.warn('[Brain] Audio extraction skipped:', err.message);
                        resolve();
                    })
                    .run();
            });

            // 3. Transcribe with Whisper via fal.ai
            let transcript = '';
            if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 1000) {
                try {
                    const { fal } = require('@fal-ai/client');
                    const audioBuffer = fs.readFileSync(audioPath);
                    const base64Audio = audioBuffer.toString('base64');
                    const result = await fal.subscribe('fal-ai/whisper', {
                        input: {
                            audio_url: `data:audio/mp3;base64,${base64Audio}`,
                            task: 'transcribe',
                            language: 'auto'
                        }
                    });
                    transcript = result?.data?.text || '';
                    console.log('[Brain] Transcript length:', transcript.length);
                } catch (err) {
                    console.warn('[Brain] Transcription failed, proceeding with frames only:', err.message);
                }
            }

            // 4. Analyze every 3rd frame with Claude Vision
            const client = new Anthropic();
            const frameFiles = fs.readdirSync(framesDir).sort();
            const frameAnalyses = [];

            for (let i = 0; i < frameFiles.length; i += 3) {
                const framePath = path.join(framesDir, frameFiles[i]);
                if (!fs.existsSync(framePath)) continue;

                const base64Frame = fs.readFileSync(framePath).toString('base64');

                try {
                    const response = await client.messages.create({
                        model: 'claude-haiku-4-5',
                        max_tokens: 500,
                        messages: [{
                            role: 'user',
                            content: [
                                {
                                    type: 'image',
                                    source: { type: 'base64', media_type: 'image/jpeg', data: base64Frame }
                                },
                                {
                                    type: 'text',
                                    text: `Frame ${i + 1} from an Etsy/POD ${videoType} video. Analyze what's visible:
- Etsy interface: describe metrics, settings, or listings shown
- Analytics/charts: extract key numbers and insights
- Presentation slide: extract main points
- Product/design: describe it
Be concise and focus on actionable Etsy/POD business insights.`
                                }
                            ]
                        }]
                    });
                    frameAnalyses.push(`[Frame ${i + 1}]: ${response.content[0].text}`);
                } catch (err) {
                    console.warn(`[Brain] Frame ${i + 1} analysis failed:`, err.message);
                }
            }

            // 5. Synthesize all signals into structured knowledge
            const synthesisResponse = await client.messages.create({
                model: 'claude-haiku-4-5',
                max_tokens: 2000,
                messages: [{
                    role: 'user',
                    content: `You are an Etsy POD business expert. Analyze this ${videoType} content and extract actionable knowledge.

AUDIO TRANSCRIPT:
${transcript.slice(0, 3000) || '(No audio transcript available)'}

SCREEN ANALYSIS (${frameAnalyses.length} frames):
${frameAnalyses.join('\n').slice(0, 3000)}

Structure your response with these sections:
## KEY INSIGHTS
## ETSY ALGORITHM TIPS
## SEO TIPS (titles, tags, keywords)
## PRODUCT & NICHE IDEAS
## ACTION ITEMS
## IF-THEN RULES

Be specific and actionable. Focus on what can be immediately applied.`
                }]
            });

            const synthesis = synthesisResponse.content[0].text;

            // 6. Save to CorporateMemory
            const category = categoryOverride || detectCategory(synthesis);
            const embeddingText = `${title} ${synthesis.slice(0, 2000)}`;
            const vectorEmbedding = await generateEmbedding(embeddingText);

            const memory = await prisma.corporateMemory.create({
                data: {
                    workspaceId,
                    type: 'VIDEO_FULL',
                    title,
                    content: synthesis.slice(0, 500),
                    category,
                    analysisResult: {
                        synthesis,
                        transcript: transcript.slice(0, 5000),
                        frameCount: frameFiles.length,
                        videoType,
                        sourceType: 'claude_video',
                        seoUpdated: false
                    },
                    sourceUrl: videoPath,
                    ...(vectorEmbedding && { vectorEmbedding })
                }
            });

            // 7. Auto-extract and merge SEO insights
            const seoUpdated = await this.extractSeoKnowledge(workspaceId, synthesis);
            if (seoUpdated) {
                await prisma.corporateMemory.update({
                    where: { id: memory.id },
                    data: { analysisResult: { ...memory.analysisResult, seoUpdated: true } }
                });
            }

            return {
                transcript: transcript.slice(0, 5000),
                frameCount: frameFiles.length,
                synthesis,
                videoType,
                memory,
                seoUpdated
            };
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    }

    // ─── Text Knowledge Ingestion ──────────────────────────────────────────────

    async addTextKnowledge(workspaceId, title, textContent, source = 'manual', category = null) {
        console.log(`[Brain] Processing text note: ${title}`);
        const client = new Anthropic();

        const response = await client.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 1500,
            messages: [{
                role: 'user',
                content: `You are an Etsy POD business expert. Process this content and extract actionable knowledge.

SOURCE: ${source}
CONTENT:
${textContent.slice(0, 4000)}

Structure your response with these sections:
## KEY INSIGHTS
## ETSY ALGORITHM TIPS
## SEO TIPS
## PRODUCT & NICHE IDEAS
## ACTION ITEMS
## IF-THEN RULES

Be specific and immediately actionable.`
            }]
        });

        const synthesis = response.content[0].text;

        const resolvedCategory = category || detectCategory(synthesis);
        const embeddingText = `${title} ${synthesis.slice(0, 2000)}`;
        const vectorEmbedding = await generateEmbedding(embeddingText);

        const memory = await prisma.corporateMemory.create({
            data: {
                workspaceId,
                type: 'TEXT_NOTE',
                title,
                content: textContent.slice(0, 500),
                category: resolvedCategory,
                analysisResult: {
                    synthesis,
                    sourceType: 'text',
                    source,
                    seoUpdated: false
                },
                sourceUrl: source,
                ...(vectorEmbedding && { vectorEmbedding })
            }
        });

        const seoUpdated = await this.extractSeoKnowledge(workspaceId, synthesis);
        if (seoUpdated) {
            await prisma.corporateMemory.update({
                where: { id: memory.id },
                data: { analysisResult: { ...memory.analysisResult, seoUpdated: true } }
            });
        }

        return { ...memory, seoUpdated };
    }

    // ─── SEO Knowledge Base Integration ───────────────────────────────────────

    async extractSeoKnowledge(workspaceId, synthesis) {
        try {
            const { getKnowledge, manualUpdateKnowledge } = require('./seo-knowledge.service');
            const client = new Anthropic();

            const checkResponse = await client.messages.create({
                model: 'claude-haiku-4-5',
                max_tokens: 800,
                messages: [{
                    role: 'user',
                    content: `Extract ONLY Etsy SEO-relevant content from the text below — titles, tags, keywords, search algorithm tips. If nothing is SEO-relevant, respond with exactly "NONE".

${synthesis.slice(0, 3000)}`
                }]
            });

            const seoExtract = checkResponse.content[0].text.trim();
            if (seoExtract === 'NONE' || seoExtract.length < 80) return false;

            const existing = await getKnowledge(workspaceId);
            const merged = `${existing}\n\n## NEW INSIGHTS FROM BRAIN ANALYSIS (${new Date().toLocaleDateString()}):\n${seoExtract}`;
            await manualUpdateKnowledge(workspaceId, merged);

            console.log('[Brain] SEO knowledge base updated');
            return true;
        } catch (err) {
            console.warn('[Brain] SEO extraction failed:', err.message);
            return false;
        }
    }
}

module.exports = new MultimodalBrainService();
