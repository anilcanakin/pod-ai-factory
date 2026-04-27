const { Worker } = require('bullmq');
const redisConnection = require('../config/redis');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const prisma = require('../lib/prisma');

const outputDir = path.join(__dirname, '../../assets/outputs');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Defining our Mockup Templates with 0-1 percentage areas and real asset paths
const templates = {
    'black_tshirt_front': {
        path: 'assets/mockups/blank-black-tshirt.jpg',
        x: 0.32, y: 0.25, w: 0.36, h: 0.45, // Chest area positioning
        label: 'Black T-Shirt'
    }
};

/**
 * Downloads a design from a URL, resizes it, and composites it onto a template.
 */
async function generateMockup(designUrl, imageId, templateId) {
    const fetch = require('node-fetch');
    const { uploadBufferToStorage } = require('../services/storage.service');
    
    const config = templates[templateId] || templates['black_tshirt_front'];
    const templatePath = path.resolve(__dirname, '../../', config.path);

    if (!fs.existsSync(templatePath)) {
        throw new Error(`Template image not found at ${templatePath}`);
    }

    // 1. Fetch the design image (the transparent upscaled PNG)
    console.log(`[MockupWorker] Fetching design from: ${designUrl}`);
    const designResponse = await fetch(designUrl);
    if (!designResponse.ok) throw new Error(`Failed to fetch design image: ${designResponse.status}`);
    const designBuffer = await designResponse.buffer();

    // 2. Get Template Metadata to calculate pixel coordinates
    const templateMetadata = await sharp(templatePath).metadata();
    const bgWidth = templateMetadata.width;
    const bgHeight = templateMetadata.height;

    const printW = Math.floor(bgWidth * config.w);
    const printH = Math.floor(bgHeight * config.h);
    const printX = Math.floor(bgWidth * config.x);
    const printY = Math.floor(bgHeight * config.y);

    // 3. Process Design: Resize to fit the print area
    const resizedDesign = await sharp(designBuffer)
        .resize(printW, printH, { fit: 'inside', withoutEnlargement: true })
        .toBuffer();

    // 4. Composite: Design layer over Template layer
    console.log(`[MockupWorker] Compositing layer for ${templateId}...`);
    const mockupBuffer = await sharp(templatePath)
        .composite([{
            input: resizedDesign,
            left: printX,
            top: printY,
            blend: 'multiply' // Essential for textile texture integration
        }])
        .jpeg({ quality: 85 })
        .toBuffer();

    // 5. Upload to Supabase Storage (mockups folder)
    const storagePath = `mockups/${imageId}_${templateId}_${Date.now()}.jpg`;
    const publicUrl = await uploadBufferToStorage(mockupBuffer, storagePath, 'image/jpeg');

    return publicUrl;
}

async function processMockups(job) {
    console.log('[MockupWorker] İş kuyruktan yakalandı! JobID:', job.id, '| imageId:', job.data.imageId);
    const { imageId } = job.data;

    try {
        const image = await prisma.image.findUnique({ where: { id: imageId } });
        if (!image || !image.imageUrl || image.imageUrl === 'PENDING') {
            throw new Error(`Valid design URL not found for Image ${imageId}`);
        }

        console.log(`[MockupWorker] Generating real-world mockups for image: ${imageId}`);

        const generatedMockups = [];

        for (const [templateId, config] of Object.entries(templates)) {
            console.log(`[MockupWorker] Processing template: ${templateId} (${config.label})`);
            
            const mockupUrl = await generateMockup(image.imageUrl, imageId, templateId);

            const mockupRecord = await prisma.mockup.create({
                data: {
                    imageId: imageId,
                    templateId: templateId,
                    mockupUrl: mockupUrl
                }
            });
            generatedMockups.push(mockupRecord);
        }

        console.log(`[MockupWorker] Successfully generated ${generatedMockups.length} mockups for image ${imageId}`);

        // Trigger AI-SEO Engine automatically after mockup generation
        const etsyService = require('../services/etsy.service');
        const taskService = require('../services/task.service');

        // Increment Mockup task
        await taskService.incrementTask('MOCKUP');

        try {
            await etsyService.generateSEO(imageId);
            console.log(`[MockupWorker] AI-SEO generated for ${imageId}`);
            // Increment SEO task
            await taskService.incrementTask('SEO');
        } catch (seoErr) {
            console.warn(`[MockupWorker] SEO generation failed (non-fatal): ${seoErr.message}`);
        }

        return generatedMockups;

    } catch (err) {
        console.error(`[MockupWorker] Error on image ${imageId}:`, err);
        throw err;
    }
}

const mockupWorker = new Worker('mockup-generation', processMockups, {
    connection: redisConnection,
    concurrency: 2,
});

mockupWorker.on('active', (job) => {
    console.log(`[MockupWorker] ▶  İş başladı  | jobId=${job.id} | imageId=${job.data.imageId}`);
});

mockupWorker.on('completed', (job, result) => {
    const count = Array.isArray(result) ? result.length : 0;
    console.log(`[MockupWorker] ✓  İş tamamlandı | jobId=${job.id} | imageId=${job.data.imageId} | mockupCount=${count}`);
});

mockupWorker.on('failed', (job, err) => {
    console.error(`[MockupWorker] ✗  İş başarısız | jobId=${job?.id} | imageId=${job?.data?.imageId} | hata=${err.message}`);
});

mockupWorker.on('stalled', (jobId) => {
    console.warn(`[MockupWorker] ⚠  İş takıldı (stalled) | jobId=${jobId}`);
});

mockupWorker.on('error', (err) => {
    console.error('[MockupWorker] Worker hatası:', err.message);
});

console.log('[MockupWorker] ✔  Kuyruk dinleniyor → mockup-generation');

module.exports = { mockupWorker, processMockups };
