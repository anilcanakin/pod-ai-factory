const { PrismaClient } = require('@prisma/client');
const OpenAI = require('openai');

const prisma = new PrismaClient({
    datasources: {
        db: { url: process.env.DATABASE_URL }
    }
});
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const VISION_SYSTEM_PROMPT = `You are an expert AI vision assistant specialized in analyzing images for POD (Print on Demand) apparel, specifically t-shirt screenprint and vector designs. 
Your ONLY output should be a strict JSON object responding to the image provided. Do not use any markdown or free text. You MUST adhere to the provided JSON schema EXACTLY.
All categorical fields must use exactly one of the provided enum values. For palette, provide color names. For palette_hex, provide the exact matching hex codes.`;

const VISION_SCHEMA = {
    type: "json_schema",
    json_schema: {
        name: "pod_vision_analysis",
        schema: {
            type: "object",
            properties: {
                style: {
                    type: "string",
                    description: "The overarching aesthetic style (e.g., retro distressed, modern minimalist, vintage 70s, kawaii cute, grunge_punk, badge_emblem, cartoon mascot, neon cyberpunk)."
                },
                layout: {
                    type: "string",
                    description: "The composition or layout of the design (e.g., circular badge, centered graphic, typographical arch, top year mid banner bottom hook)."
                },
                icon_description: {
                    type: "string",
                    description: "A description of the central icon or subject (e.g., roaring tiger, skull with wings, camping tent, eagle, cat)."
                },
                typography: {
                    type: "string",
                    description: "The style, influence, and integration of the text elements (e.g., curved vintage serif, bold collegiate sans, bubbly cartoon text, no text)."
                },
                palette: {
                    type: "array",
                    items: { type: "string" },
                    description: "Array of dominant color names using human-readable names (e.g., ['navy_blue', 'offwhite', 'vintage_red', 'cream'])."
                }
            },
            required: ["style", "layout", "icon_description", "typography", "palette"],
            additionalProperties: false
        },
        strict: true
    }
};

class VisionService {
    // imageUrlBase64OrUrl can be a standard URL or a base64 data URI
    async analyzeImage(imageUrlBase64OrUrl, imageId = null, jobId = null) {
        let rawOpenAIResponse = "";
        let parsedVisionJson = {};

        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    { role: "system", content: VISION_SYSTEM_PROMPT },
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Please analyze the design and provide the required JSON structure." },
                            {
                                type: "image_url",
                                image_url: {
                                    url: imageUrlBase64OrUrl,
                                },
                            },
                        ],
                    },
                ],
                response_format: VISION_SCHEMA,
            });

            rawOpenAIResponse = response.choices[0].message.content;

            try {
                parsedVisionJson = JSON.parse(rawOpenAIResponse);
            } catch (e) {
                console.error("Failed to parse Vision JSON, using fallback data.");
            }

        } catch (error) {
            console.error("OpenAI Vision API error:", error);
            rawOpenAIResponse = error.message || "Unknown error";
        }

        // Default missing fields and ensure strict schema compliance in case of parsing errors
        const finalJSON = {
            style: parsedVisionJson.style || "vintage distressed",
            layout: parsedVisionJson.layout || "centered badge",
            icon_description: parsedVisionJson.icon_description || "unknown subject",
            typography: parsedVisionJson.typography || "bold vintage serif",
            palette: Array.isArray(parsedVisionJson.palette) && parsedVisionJson.palette.length > 0 ? parsedVisionJson.palette : ["black", "white"]
        };

        const dbRecord = await prisma.visionAnalysis.create({
            data: {
                imageId,
                jobId,
                rawProviderResponse: rawOpenAIResponse,
                parsedVisionJson: finalJSON
            }
        });

        return dbRecord;
    }
}

module.exports = {
    visionService: new VisionService(),
    VISION_SCHEMA
};
