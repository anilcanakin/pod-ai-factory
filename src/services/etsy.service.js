const OpenAI = require('openai');

const prisma = require('../lib/prisma');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Etsy Service - AI-powered SEO and Listing Management
 */
class EtsyService {
    /**
     * Generates SEO data (Title, Tags, Description) for a given image.
     * Uses OpenAI's multimodal vision capabilities to analyze the design.
     */
    async generateSEO(imageId) {
        console.log(`[EtsyService] Generating SEO for image: ${imageId}`);
        const knowledgeContext = require("./knowledge-context.service");
        const brainContext = await knowledgeContext.getSeoContext('default-workspace');

        const image = await prisma.image.findUnique({
            where: { id: imageId },
            include: { job: true }
        });

        if (!image) throw new Error('Image not found');

        const systemPrompt = `You are an expert Etsy SEO specialist and copywriter. 
Your goal is to generate high-converting SEO metadata for a Print-on-Demand (POD) product based on the design provided.

OUTPUT FORMAT (Strict JSON ONLY):
{
  "title": "SEO-friendly title, max 140 chars, include high-traffic keywords, separated by commas or pipes",
  "tags": ["13 long-tail tags, max 20 chars each"],
  "description": "Engaging product storytelling including fabric/care placeholders."
}

CRITERIA:
1. Title: Front-load the most important keywords. Include psychological triggers based on customer reviews.
2. Tags: Exactly 13 tags. Focus on what buyers type (e.g. 'gift for boxer dad').
3. Description: Mention the artistic style and the mood of the design.
4. Duygu Analizi / Psikolojik Satış: Yorumlara/ürün hedefine dayanarak, müşterilerin aradığı 'duygusal anahtar kelimeleri' ve satın alma motivasyonlarını mutlaka ekle (Örn: 'perfect gift for dad', 'softest hoodie ever', 'cute aesthetic').

## EXPERT SEO INSIGHTS (Priority):
${brainContext}`;

        const userPrompt = `Design Prompt Used: "${image.promptUsed}"
Product Type: Graphic T-Shirt
Target Niche: ${image.job?.niche || 'General'}
Style: ${image.job?.style || 'Modern'}

Generate the SEO JSON packet for this design.`;

        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: systemPrompt },
                    {
                        role: "user",
                        content: [
                            { type: "text", text: userPrompt },
                            { type: "image_url", image_url: { url: image.imageUrl } }
                        ]
                    }
                ],
                response_format: { type: "json_object" }
            });

            const seoData = JSON.parse(response.choices[0].message.content);
            console.log(`[EtsyService] SEO generated successfully for ${imageId}`);

            // Save to DB
            return await this.saveSEOToDb(imageId, seoData);

        } catch (err) {
            console.error('[EtsyService] SEO generation failed:', err.message);
            throw err;
        }
    }

    /**
     * Saves SEO package to the database.
     */
    async saveSEOToDb(imageId, seoData) {
        return await prisma.sEOData.upsert({
            where: { imageId },
            update: {
                title: seoData.title,
                tags: seoData.tags,
                description: seoData.description
            },
            create: {
                imageId,
                title: seoData.title,
                tags: seoData.tags,
                description: seoData.description
            }
        });
    }

    /**
     * SKELETON: Submits the SEO data and Mockup to Etsy as a Draft Listing.
     * To be implemented with official Etsy API v3 credentials.
     */
    async createEtsyListingDraft(imageId) {
        const image = await prisma.image.findUnique({
            where: { id: imageId },
            include: { seoData: true, mockups: true }
        });

        if (!image || !image.seoData) {
            throw new Error('SEO data must be generated before creating an Etsy draft.');
        }

        console.log(`[EtsyService] Preparing Draft for Etsy API (v3)...`);
        
        const listingPayload = {
            title: image.seoData.title,
            description: image.seoData.description,
            tags: image.seoData.tags,
            price: "24.99",
            quantity: 99,
            who_made: "i_did",
            when_made: "made_to_order",
            item_weight: 0.2,
            item_weight_unit: "lb",
            state: "draft",
            materials: ["Cotton", "Eco-friendly Ink"],
            // Images would be uploaded via Etsy's uploadListingImage endpoint
            image_urls: image.mockups.map(m => m.mockupUrl)
        };

        // TODO: Implement actual axios/fetch call to https://openapi.etsy.com/v3/application/shops/{shop_id}/listings
        console.log('[EtsyService] Draft payload ready (Simulation):', JSON.stringify(listingPayload, null, 2));
        
        return { success: true, message: "Draft simulation completed (Skeleton Only)", payload: listingPayload };
    }
}

module.exports = new EtsyService();
