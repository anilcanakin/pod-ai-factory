const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { OpenAI } = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const billingService = require('./billing.service');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

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
        
        const imageData = Buffer.from(fs.readFileSync(imagePath)).toString('base64');

        // 1. Vision Interpretation
        const analysis = await this.analyzeVision(imageData);
        
        const synthesis = `SOCIAL INTELLIGENCE REPORT: ${title}\nSTYLE: ${analysis.style}\nPALETTE: ${analysis.palette}\nTYPOGRAPHY: ${analysis.fontType}\nTEXT: ${analysis.extractedText}\nDESIGN RULE: ${analysis.designRule}`;

        const vectorEmbedding = await generateEmbedding(synthesis);

        const memory = await prisma.corporateMemory.create({
            data: {
                workspaceId,
                type: 'SOCIAL_PROOF',
                sourceType: 'Social',
                title,
                content: synthesis.slice(0, 1000),
                category: 'niche_research',
                analysisResult: { ...analysis, sourceType: 'social_proof' },
                vectorEmbedding,
                sourceUrl: imagePath
            }
        });

        return memory;
    }

    /**
     * Ingest Expert Insights (Instagram Subscription Content)
     */
    async ingestExpertInsight(workspaceId, imagePath, title = "Expert Strategy") {
        console.log(`[BrainService] Extracting expert insight: ${title}`);
        
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

        const memory = await prisma.corporateMemory.create({
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
                vectorEmbedding,
                sourceUrl: imagePath
            }
        });

        return memory;
    }

    async analyzeVision(base64Image) {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const prompt = `Analyze this social media design for POD intelligence. Return ONLY JSON: { "style": "...", "palette": "...", "fontType": "...", "extractedText": "...", "mood": "...", "designRule": "..." }`;
        const result = await model.generateContent([prompt, { inlineData: { data: base64Image, mimeType: 'image/jpeg' } }]);
        
        // Log Usage
        if (result.response.usageMetadata) {
            await billingService.logUsage('gemini', 'gemini-1.5-flash', result.response.usageMetadata, 'default-workspace', { feature: 'social_vision' });
        }

        const text = result.response.text().trim().replace(/```json/g, '').replace(/```/g, '');
        return JSON.parse(text);
    }

    async analyzeExpertVision(base64Image) {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const prompt = `Analyze this Instagram subscription / Expert strategy post for POD.
Return ONLY a JSON object (no markdown):
{
  "recommendedNiche": "The specific niche or theme recommended",
  "keywords": ["tag1", "tag2", "tag3"],
  "designNotes": "Layout, font, or color advice mentioned",
  "aiStrategy": "Summarize the core tactic described in the post into a rule"
}`;

        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: base64Image,
                    mimeType: 'image/jpeg'
                }
            }
        ]);

        // Log Usage
        if (result.response.usageMetadata) {
            await billingService.logUsage('gemini', 'gemini-1.5-flash', result.response.usageMetadata, 'default-workspace', { feature: 'expert_vision' });
        }

        const text = result.response.text().trim().replace(/```json/g, '').replace(/```/g, '');
        try {
            return JSON.parse(text);
        } catch (e) {
            console.error('[BrainService] Expert Vision Error:', e);
            return { recommendedNiche: "Unknown", keywords: [], designNotes: "None", aiStrategy: "Follow expert trend." };
        }
    }
}

module.exports = new BrainService();
