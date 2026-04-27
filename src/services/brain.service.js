const prisma = require('../lib/prisma');
const { OpenAI } = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const billingService = require('./billing.service');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const _geminiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || '';
const genAI = _geminiKey ? new GoogleGenerativeAI(_geminiKey) : null;

// Gemini rate-limit shield
const GEMINI_COOLDOWN_MS = 5000;
let _lastGeminiCall = 0;
async function geminiCooldown() {
    const now = Date.now();
    const wait = GEMINI_COOLDOWN_MS - (now - _lastGeminiCall);
    if (wait > 0) {
        console.log(`[Gemini] Cooldown ${wait}ms...`);
        await new Promise(r => setTimeout(r, wait));
    }
    _lastGeminiCall = Date.now();
}

// Ensures the workspace row exists before any FK-dependent insert.
// Called with any workspaceId that might be a synthetic fallback (e.g. 'default-workspace').
async function ensureWorkspace(workspaceId) {
    await prisma.workspace.upsert({
        where: { id: workspaceId },
        update: {},
        create: { id: workspaceId, name: 'Default Workspace', slug: workspaceId }
    });
}

async function generateEmbedding(text) {
    try {
        const response = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: text.slice(0, 8191)
        });
        return response.data[0].embedding;
    } catch (err) {
        console.warn('[BrainService] Embedding generation failed:', err.message);
        return null;
    }
}

class BrainService {
    /**
     * Ingest Social Proof / Instagram Trend Analysis
     */
    async ingestSocialProof(workspaceId, imagePath, title = "Social Design Trend") {
        console.log(`[BrainService] Analyzing social proof: ${title}`);
        await ensureWorkspace(workspaceId);

        const imageData = Buffer.from(fs.readFileSync(imagePath)).toString('base64');

        // 1. Vision Interpretation
        const analysis = await this.analyzeVision(imageData);
        
        const synthesis = `SOCIAL INTELLIGENCE REPORT: ${title}\nSTYLE: ${analysis.style}\nPALETTE: ${analysis.palette}\nTYPOGRAPHY: ${analysis.fontType}\nTEXT: ${analysis.extractedText}\nDESIGN RULE: ${analysis.designRule}`;

        const vectorEmbedding = await generateEmbedding(synthesis);

        let memory;
        try {
            memory = await prisma.corporateMemory.create({
                data: {
                    workspaceId,
                    type: 'SOCIAL_PROOF',
                    sourceType: 'Social',
                    title,
                    content: synthesis.slice(0, 1000),
                    category: 'niche_research',
                    analysisResult: { ...analysis, sourceType: 'social_proof' },
                    ...(vectorEmbedding && { vectorEmbedding }),
                    sourceUrl: imagePath
                }
            });
            console.log('[BrainService] ingestSocialProof — Memory saved, id:', memory.id);
        } catch (dbErr) {
            console.error('[BrainService] ingestSocialProof — DB save FAILED:', dbErr.message);
            throw dbErr;
        }

        return memory;
    }

    /**
     * Ingest Expert Insights (Instagram Subscription Content)
     */
    async ingestExpertInsight(workspaceId, imagePath, title = "Expert Strategy") {
        console.log(`[BrainService] Extracting expert insight: ${title}`);
        await ensureWorkspace(workspaceId);

        const imageData = Buffer.from(fs.readFileSync(imagePath)).toString('base64');

        // 1. Vision Extraction using Expert Prompting
        const analysis = await this.analyzeExpertVision(imageData);
        
        const synthesis = `EXPERT STRATEGY RECOMMENDATION: ${title}
RECOMMENDED NICHE: ${analysis.recommendedNiche}
STRATEGIC KEYWORDS: ${analysis.keywords.join(', ')}
DESIGN NOTES: ${analysis.designNotes}

AI STRATEGY:
${analysis.aiStrategy}`;

        const vectorEmbedding = await generateEmbedding(synthesis);

        let memory;
        try {
            memory = await prisma.corporateMemory.create({
                data: {
                    workspaceId,
                    type: 'EXPERT_INSIGHT',
                    sourceType: 'Expert',
                    title,
                    content: synthesis.slice(0, 1000),
                    category: 'niche_research',
                    analysisResult: {
                        ...analysis,
                        sourceType: 'expert_insight',
                        fullSynthesis: synthesis
                    },
                    ...(vectorEmbedding && { vectorEmbedding }),
                    sourceUrl: imagePath
                }
            });
            console.log('[BrainService] ingestExpertInsight — Memory saved, id:', memory.id);
        } catch (dbErr) {
            console.error('[BrainService] ingestExpertInsight — DB save FAILED:', dbErr.message);
            throw dbErr;
        }

        return memory;
    }

    // Claude (primary) vision call — returns parsed JSON
    async _analyzeWithClaude(base64Image, prompt) {
        const response = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 512,
            messages: [{
                role: 'user',
                content: [
                    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Image } },
                    { type: 'text', text: prompt }
                ]
            }]
        });
        const text = response.content[0].text.trim().replace(/```json/g, '').replace(/```/g, '');
        return JSON.parse(text);
    }

    // Gemini (fallback) vision call — returns parsed JSON
    async _analyzeWithGemini(base64Image, prompt) {
        if (!genAI) throw new Error('Gemini key not configured');
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        await geminiCooldown();
        const result = await model.generateContent([
            prompt,
            { inlineData: { data: base64Image, mimeType: 'image/jpeg' } }
        ]);
        if (result.response.usageMetadata) {
            await billingService.logUsage('gemini', 'gemini-1.5-flash', result.response.usageMetadata, 'default-workspace', { feature: 'brain_vision' });
        }
        const text = result.response.text().trim().replace(/```json/g, '').replace(/```/g, '');
        return JSON.parse(text);
    }

    async analyzeVision(base64Image) {
        const prompt = `Analyze this social media design for POD intelligence. Return ONLY valid JSON (no markdown): { "style": "...", "palette": "...", "fontType": "...", "extractedText": "...", "mood": "...", "designRule": "..." }`;

        try {
            console.log('[BrainService] analyzeVision → Claude (primary)');
            return await this._analyzeWithClaude(base64Image, prompt);
        } catch (err) {
            console.warn(`[BrainService] Claude vision failed (${err.message}), trying Gemini...`);
            try {
                return await this._analyzeWithGemini(base64Image, prompt);
            } catch (geminiErr) {
                console.error('[BrainService] Both providers failed:', geminiErr.message);
                return { style: 'Unknown', palette: 'Unknown', fontType: 'Unknown', extractedText: '', mood: 'Unknown', designRule: 'N/A' };
            }
        }
    }

    async analyzeExpertVision(base64Image) {
        const prompt = `Analyze this Instagram subscription / Expert strategy post for POD.
Return ONLY a valid JSON object (no markdown):
{
  "recommendedNiche": "The specific niche or theme recommended",
  "keywords": ["tag1", "tag2", "tag3"],
  "designNotes": "Layout, font, or color advice mentioned",
  "aiStrategy": "Summarize the core tactic described in the post into a rule"
}`;

        try {
            console.log('[BrainService] analyzeExpertVision → Claude (primary)');
            return await this._analyzeWithClaude(base64Image, prompt);
        } catch (err) {
            console.warn(`[BrainService] Claude expert vision failed (${err.message}), trying Gemini...`);
            try {
                return await this._analyzeWithGemini(base64Image, prompt);
            } catch (geminiErr) {
                console.error('[BrainService] Both providers failed:', geminiErr.message);
                return { recommendedNiche: 'Unknown', keywords: [], designNotes: 'None', aiStrategy: 'Follow expert trend.' };
            }
        }
    }
}

module.exports = new BrainService();
