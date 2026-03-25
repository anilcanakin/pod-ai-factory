const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Helper function to truncate title
function cleanTitle(title) {
    if (title.length > 140) return title.substring(0, 137).trim() + "...";
    return title;
}

// Generate EXACTLY 13 tags, no duplicates, max 20 chars
function generateTags(json) {
    let pool = new Set();

    // Attempt to pull from JSON
    const tryAdd = (str) => {
        if (!str) return;
        const s = String(str).toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().substring(0, 20);
        if (s && s !== 'other_pod_style' && s !== 'unknown_color' && s !== 'unknown_icon') {
            pool.add(s);
        }
    };

    tryAdd(json.style);
    tryAdd(json.composition);
    tryAdd(json.text_layout);
    tryAdd(json.niche_guess);

    if (json.palette) json.palette.forEach(tryAdd);
    if (json.icon_family) json.icon_family.forEach(tryAdd);

    // Padding with generic terms if we don't have 13
    const generics = [
        "tshirt design", "graphic tee", "custom apparel", "gift for him", "gift for her",
        "trendy shirt", "aesthetic tee", "vintage look", "streetwear", "casual wear",
        "unisex shirt", "funny shirt", "cool graphic", "unique design", "print on demand"
    ];

    let gIdx = 0;
    while (pool.size < 13 && gIdx < generics.length) {
        tryAdd(generics[gIdx]);
        gIdx++;
    }

    const tagsArray = Array.from(pool).slice(0, 13);

    // Ensure absolutely exactly 13
    while (tagsArray.length < 13) {
        tagsArray.push(`tag${Math.floor(Math.random() * 99999)}`);
    }

    return tagsArray;
}

// POST /api/seo/generate
router.post('/generate', async (req, res) => {
    try {
        const { imageId, jobId } = req.body;

        let localJobId = jobId;
        // If imageId provided, we can find the jobId
        if (imageId && !jobId) {
            const img = await prisma.image.findUnique({ where: { id: imageId } });
            if (img) localJobId = img.jobId;
        }

        if (!localJobId) {
            return res.status(400).json({ error: "Job ID or Image ID required." });
        }

        // Fetch vision properties directly from job history
        const visionAna = await prisma.visionAnalysis.findFirst({
            where: { jobId: localJobId },
            orderBy: { createdAt: 'desc' }
        });

        if (!visionAna) return res.status(400).json({ error: "Vision JSON not found for this Job" });
        const json = visionAna.parsedVisionJson;

        // Generate Title (Main keyword first)
        const mainKeyword = `${(json.style || 'Graphic').replace(/_/g, ' ')} ${json.niche_guess ? json.niche_guess.replace(/_/g, ' ') : 'T-Shirt'}`.substring(0, 60);
        const titleRaw = `${mainKeyword} | Trendy Custom Apparel | Perfect Aesthetic Gift | Premium Cotton Graphics`;
        const title = cleanTitle(titleRaw);

        // Generate Description
        const desc = `🌟 Discover our latest ${json.style ? json.style.replace(/_/g, ' ') : 'amazing'} design! 🌟

✨ Features:
• Unique graphic composition: ${json.composition ? json.composition.replace(/_/g, ' ') : 'high quality'}
• Striking elements featuring: ${json.icon_family ? json.icon_family.join(', ').replace(/_/g, ' ') : 'artistic details'}
• Ideal for: ${json.niche_guess ? json.niche_guess.replace(/_/g, ' ') : 'anyone'}

👕 Printed on premium material. Grab yours today to stand out in style!`;

        // Generate EXACTLY 13 Tags
        const tags = generateTags(json);

        // SEO Strict Validation
        const BANNED_WORDS = ['nike', 'disney', 'marvel', 'star wars', 'gucci', 'louis vuitton', 'chanel', 'prada'];
        if (title.length > 140) throw new Error("SEO Validation Failed: Title exceeds 140 characters.");
        if (tags.length !== 13) throw new Error(`SEO Validation Failed: Exactly 13 tags required, got ${tags.length}.`);

        const uniqueTags = new Set(tags);
        if (uniqueTags.size !== 13) throw new Error("SEO Validation Failed: Duplicate tags detected.");

        for (const tag of tags) {
            if (tag.length > 20) throw new Error(`SEO Validation Failed: Tag '${tag}' exceeds 20 characters.`);
        }

        const fullText = `${title.toLowerCase()} ${tags.join(' ')} ${desc.toLowerCase()}`;
        for (const word of BANNED_WORDS) {
            if (fullText.includes(word)) {
                throw new Error(`SEO Validation Failed: Banned word '${word}' detected. Risk of trademark infringement.`);
            }
        }

        // Update DB
        const seoData = await prisma.sEOData.upsert({
            where: { imageId: imageId },
            update: {
                title,
                description: desc,
                tags
            },
            create: {
                imageId: imageId,
                title,
                description: desc,
                tags
            }
        });

        res.json(seoData);

    } catch (err) {
        console.error('SEO Generation error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
