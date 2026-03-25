const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ── Shared system prompt ──────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert POD (Print-on-Demand) designer. Analyze the reference image and write a single detailed generation prompt that captures: art style, color palette, composition, typography style, mood, and subject matter. The output design MUST be on a pure white background (#FFFFFF), perfect for t-shirt screen printing, vector-clean edges, no background scenery. Return ONLY the prompt text, no explanation, no prefix.`;

// ── Legacy Vision Schema (used by etsy-mode) ──────────────────
const VISION_SCHEMA = {
    type: "json_schema",
    json_schema: {
        name: "pod_vision_analysis",
        schema: {
            type: "object",
            properties: {
                style: { type: "string", description: "Overarching aesthetic style." },
                layout: { type: "string", description: "Composition or layout of the design." },
                icon_description: { type: "string", description: "Central icon or subject description." },
                typography: { type: "string", description: "Style of text elements." },
                palette: { type: "array", items: { type: "string" }, description: "Dominant color names." }
            },
            required: ["style", "layout", "icon_description", "typography", "palette"],
            additionalProperties: false
        },
        strict: true
    }
};

// ── Main analyze function (multi-provider) ────────────────────
async function analyzeImage(base64Image, mimeType = 'image/jpeg') {
    const useVision = process.env.USE_VISION !== 'false';

    if (!useVision) {
        return { prompt: generateSyntheticPrompt(), isSynthetic: true, provider: 'synthetic' };
    }

    // Provider 1: Anthropic Claude
    if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.length > 10 && !process.env.ANTHROPIC_API_KEY.includes('your_')) {
        try {
            const client = new Anthropic();
            const response = await client.messages.create({
                model: 'claude-haiku-4-5',
                max_tokens: 1024,
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mimeType,
                                data: base64Image
                            }
                        },
                        {
                            type: 'text',
                            text: 'Analyze this POD design and write a generation prompt.'
                        }
                    ]
                }],
                system: SYSTEM_PROMPT
            });

            const prompt = response.content[0].text.trim();
            console.log('[Vision] Provider: Anthropic Claude');
            return { prompt, isSynthetic: false, provider: 'anthropic' };

        } catch (err) {
            console.warn('[Vision] Anthropic failed, trying OpenAI:', err.message);
        }
    }

    // Provider 2: Google Gemini Vision
    if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY.length > 10 && !process.env.GOOGLE_API_KEY.includes('your_')) {
        try {
            const { GoogleGenerativeAI } = require('@google/generative-ai');
            const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
            const geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

            const imagePart = {
                inlineData: {
                    data: base64Image,
                    mimeType: mimeType
                }
            };

            const result = await geminiModel.generateContent([
                SYSTEM_PROMPT,
                imagePart
            ]);

            const prompt = result.response.text().trim();
            console.log('[Vision] Provider: Google Gemini');
            return { prompt, isSynthetic: false, provider: 'gemini' };

        } catch (err) {
            console.warn('[Vision] Gemini failed, trying OpenAI:', err.message);
        }
    }

    // Provider 3: OpenAI GPT-4o
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 10 && !process.env.OPENAI_API_KEY.includes('your_')) {
        try {
            const openai = new OpenAI();
            const response = await openai.chat.completions.create({
                model: 'gpt-4o',
                max_tokens: 1024,
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:${mimeType};base64,${base64Image}`
                            }
                        },
                        {
                            type: 'text',
                            text: SYSTEM_PROMPT
                        }
                    ]
                }]
            });

            const prompt = response.choices[0].message.content.trim();
            console.log('[Vision] Provider: OpenAI GPT-4o');
            return { prompt, isSynthetic: false, provider: 'openai' };

        } catch (err) {
            console.warn('[Vision] OpenAI failed, falling back to synthetic:', err.message);
        }
    }

    // Fallback: Synthetic
    console.warn('[Vision] No API keys available, using synthetic prompt');
    return { prompt: generateSyntheticPrompt(), isSynthetic: true, provider: 'synthetic' };
}

// ── Synthetic prompt generator ────────────────────────────────
function generateSyntheticPrompt() {
    const styles = ['vintage distressed', 'retro bold', 'minimalist line art', 'grunge vector'];
    const subjects = ['eagle', 'wolf', 'mountain landscape', 'geometric pattern'];
    const style = styles[Math.floor(Math.random() * styles.length)];
    const subject = subjects[Math.floor(Math.random() * subjects.length)];
    return `A ${style} t-shirt graphic of a ${subject}, pure white background, vector clean, screen print ready, high contrast`;
}

// ── Variation generator (multi-provider) ──────────────────────
async function getVariations(basePrompt, count = 4, variationMode = 'subject') {
    const useVision = process.env.USE_VISION !== 'false';

    if (!useVision) {
        return { variations: generateSyntheticVariations(basePrompt, count, variationMode) };
    }

    // Try OpenAI gpt-4o-mini for variations (cheaper, fast)
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 10 && process.env.OPENAI_API_KEY !== 'your_openai_api_key') {
        try {
            const openai = new OpenAI();
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                max_tokens: 2000,
                messages: [
                    {
                        role: 'system',
                        content: `You are a POD design prompt engineer. Given a base prompt, generate ${count} variations. Each variation should change the ${variationMode} while keeping the overall style consistent. Return ONLY a JSON array of strings: ["prompt1", "prompt2", ...]`
                    },
                    {
                        role: 'user',
                        content: `Base prompt: ${basePrompt}\n\nGenerate ${count} ${variationMode} variations.`
                    }
                ]
            });

            const raw = response.choices[0].message.content.trim();
            const jsonMatch = raw.match(/\[[\s\S]*\]/);
            if (!jsonMatch) throw new Error('Could not parse variations JSON');
            return { variations: JSON.parse(jsonMatch[0]) };

        } catch (err) {
            console.warn('[Vision] OpenAI variations failed, trying Anthropic:', err.message);
        }
    }

    // Try Anthropic for variations
    if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.length > 10) {
        try {
            const client = new Anthropic();
            const response = await client.messages.create({
                model: 'claude-3-5-haiku-20241022',
                max_tokens: 2000,
                system: `You are a POD design prompt engineer. Given a base prompt, generate ${count} variations. Each variation should change the ${variationMode} while keeping the overall style consistent. Return ONLY a JSON array of strings: ["prompt1", "prompt2", ...]`,
                messages: [{
                    role: 'user',
                    content: `Base prompt: ${basePrompt}\n\nGenerate ${count} ${variationMode} variations.`
                }]
            });

            const raw = response.content[0].text.trim();
            const jsonMatch = raw.match(/\[[\s\S]*\]/);
            if (!jsonMatch) throw new Error('Could not parse variations JSON');
            return { variations: JSON.parse(jsonMatch[0]) };

        } catch (err) {
            console.warn('[Vision] Anthropic variations failed, using synthetic:', err.message);
        }
    }

    return { variations: generateSyntheticVariations(basePrompt, count, variationMode) };
}

function generateSyntheticVariations(basePrompt, count, variationMode) {
    const modeSwaps = {
        subject: ['wolf', 'eagle', 'skull with roses', 'bear', 'lion', 'shark', 'dragon', 'phoenix'],
        style: ['vintage distressed', 'minimalist line art', 'neon cyberpunk', 'watercolor soft', 'bold retro', 'grunge punk', 'kawaii cute', 'art deco'],
        color: ['navy and gold', 'red and black', 'pastel pink and white', 'forest green and cream', 'sunset orange and purple', 'teal and coral', 'monochrome grayscale', 'electric blue and yellow']
    };
    const swaps = modeSwaps[variationMode] || modeSwaps.subject;
    const variations = [];
    for (let i = 0; i < count; i++) {
        const swap = swaps[i % swaps.length];
        if (variationMode === 'subject') {
            variations.push(basePrompt.replace(/(?:of a |of an )[\w\s]+(?:\.|\,)/i, `of a ${swap}.`));
        } else if (variationMode === 'style') {
            variations.push(`${basePrompt} Reimagined in ${swap} aesthetic.`);
        } else {
            variations.push(`${basePrompt} Using a ${swap} color palette.`);
        }
    }
    return variations;
}

// ── Legacy analyzeImage for etsy-mode (structured JSON) ───────
async function analyzeImageLegacy(imageUrlBase64OrUrl, imageId = null, jobId = null) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let rawOpenAIResponse = "";
    let parsedVisionJson = {};

    const LEGACY_SYSTEM_PROMPT = `You are an expert AI vision assistant specialized in analyzing images for POD (Print on Demand) apparel, specifically t-shirt screenprint and vector designs. 
Your ONLY output should be a strict JSON object responding to the image provided. Do not use any markdown or free text. You MUST adhere to the provided JSON schema EXACTLY.
All categorical fields must use exactly one of the provided enum values. For palette, provide color names. For palette_hex, provide the exact matching hex codes.`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: LEGACY_SYSTEM_PROMPT },
                {
                    role: "user",
                    content: [
                        { type: "text", text: "Please analyze the design and provide the required JSON structure." },
                        { type: "image_url", image_url: { url: imageUrlBase64OrUrl } },
                    ],
                },
            ],
            response_format: VISION_SCHEMA,
        });
        rawOpenAIResponse = response.choices[0].message.content;
        try { parsedVisionJson = JSON.parse(rawOpenAIResponse); } catch (e) { console.error("Failed to parse Vision JSON"); }
    } catch (error) {
        console.error("OpenAI Vision API error:", error);
        rawOpenAIResponse = error.message || "Unknown error";
    }

    const finalJSON = {
        style: parsedVisionJson.style || "vintage distressed",
        layout: parsedVisionJson.layout || "centered badge",
        icon_description: parsedVisionJson.icon_description || "unknown subject",
        typography: parsedVisionJson.typography || "bold vintage serif",
        palette: Array.isArray(parsedVisionJson.palette) && parsedVisionJson.palette.length > 0 ? parsedVisionJson.palette : ["black", "white"]
    };

    const dbRecord = await prisma.visionAnalysis.create({
        data: { imageId, jobId, rawProviderResponse: rawOpenAIResponse, parsedVisionJson: finalJSON }
    });
    return dbRecord;
}

module.exports = {
    analyzeImage,
    analyzeImageLegacy,
    getVariations,
    VISION_SCHEMA
};
