const { Worker } = require('bullmq');
const { PrismaClient } = require('@prisma/client');
const redisConnection = require('../config/redis');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const prisma = new PrismaClient();

const outputDir = path.join(__dirname, '../../assets/outputs');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Defining our Mockup Templates with 0-1 percentage areas
const templates = {
    tshirt_model_white_front: { x: 0.35, y: 0.30, w: 0.30, h: 0.40 },
    hoodie_model_beige_front: { x: 0.30, y: 0.35, w: 0.40, h: 0.35 },
    sweatshirt_flatlay_ivory: { x: 0.25, y: 0.25, w: 0.50, h: 0.50 }
};

// Generates a blank background "template" and scales down the master image to match the print area
async function generateMockup(masterFileUrl, imageId, templateId) {
    const filename = `${imageId}_mockup_${templateId}.png`;
    const filepath = path.join(outputDir, filename);

    const config = templates[templateId];

    // For the MVP we simulate a template background 2000x2000
    const bgWidth = 2000;
    const bgHeight = 2000;

    const printW = Math.floor(bgWidth * config.w);
    const printH = Math.floor(bgHeight * config.h);
    const printX = Math.floor(bgWidth * config.x);
    const printY = Math.floor(bgHeight * config.y);

    // Simulated template background based on template ID
    const bgColors = {
        tshirt_model_white_front: '#ffffff',
        hoodie_model_beige_front: '#f5f5dc',
        sweatshirt_flatlay_ivory: '#fffff0'
    };

    // Load actual master file
    const absoluteMasterPath = path.resolve(__dirname, '../../', masterFileUrl);

    // Scale master to fit into the width/height
    const resizedMaster = await sharp(absoluteMasterPath)
        .resize(printW, printH, { fit: 'inside' })
        .toBuffer();

    // Composite master on top of dummy background
    await sharp({
        create: {
            width: bgWidth,
            height: bgHeight,
            channels: 4,
            background: bgColors[templateId]
        }
    })
        .composite([{
            input: resizedMaster,
            left: printX,
            top: printY,
            blend: 'multiply' // Blend requirement
        }])
        .png()
        .toFile(filepath);

    return `assets/outputs/${filename}`;
}

async function processMockups(job) {
    console.log('[MockupWorker] İş kuyruktan yakalandı! JobID:', job.id, '| imageId:', job.data.imageId);
    const { imageId } = job.data;

    try {
        const image = await prisma.image.findUnique({ where: { id: imageId } });
        if (!image || !image.masterFileUrl) {
            throw new Error(`Master file not found for Image ${imageId}`);
        }

        console.log(`[MockupWorker] Generating mockups for image: ${imageId}`);

        const generatedMockups = [];

        for (const templateId of Object.keys(templates)) {
            console.log(`[MockupWorker] Processing template: ${templateId}`);
            const mockupUrl = await generateMockup(image.masterFileUrl, imageId, templateId);

            const mockupRecord = await prisma.mockup.create({
                data: {
                    imageId: imageId,
                    templateId: templateId,
                    mockupUrl: mockupUrl
                }
            });
            generatedMockups.push(mockupRecord);
        }

        console.log(`[MockupWorker] Successfully generated 3 mockups for image ${imageId}`);
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
