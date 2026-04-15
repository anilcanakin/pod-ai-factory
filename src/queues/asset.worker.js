const { Worker } = require('bullmq');
const { PrismaClient } = require('@prisma/client');
const redisConnection = require('../config/redis');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const safetyService = require('../services/safety.service');

const prisma = new PrismaClient();

// Mock external tool calls for the MVP
async function simulateBGRemove(imageUrl) {
    // In production, this would make a network call to BG_REMOVE_API_URL
    return `${imageUrl}_nobg.png`;
}

async function simulateUpscale(imageUrl, scale, mode) {
    // In production, this would make a network call to UPSCALER_API_URL
    return `${imageUrl}_upscaled_${scale}x_${mode}.png`;
}

// Ensure the local output directory exists
const outputDir = path.join(__dirname, '../../assets/outputs');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Create a physical mock image file for the "masterFileUrl"
async function createNormalizedMaster(imageUrl, imageId) {
    const filename = `${imageId}_master_4500x5400.png`;
    const filepath = path.join(outputDir, filename);

    // Creates a blank 4500x5400 transparent canvas with some text or a placeholder
    // representing the final composited image.
    // In production, we would download `imageUrl`, resize it to 4275x5130 (leaving 5% margin),
    // and composite it onto the 4500x5400 transparent canvas.
    await sharp({
        create: {
            width: 4500,
            height: 5400,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 } // transparent
        }
    })
        .composite([{
            input: Buffer.from(`<svg width="4000" height="4000"><rect x="0" y="0" width="4000" height="4000" fill="#333" /><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="200" fill="#fff">MOCK MASTER: ${imageId}</text></svg>`),
            top: 700,
            left: 250
        }])
        .png()
        .toFile(filepath);

    return `assets/outputs/${filename}`;
}

async function processAsset(job) {
    console.log('[AssetWorker] İş kuyruktan yakalandı! JobID:', job.id, '| imageId:', job.data.imageId);
    const { imageId } = job.data;
    if (!imageId) {
        console.warn('[AssetWorker] Job data missing imageId, skipping.');
        return;
    }

    try {
        const image = await prisma.image.findUnique({
            where: { id: imageId },
            include: { job: true }
        });

        if (!image) throw new Error(`Image ${imageId} not found`);
        if (image.status !== 'APPROVED') {
            console.log(`Skipping image ${imageId} because status is ${image.status}, not APPROVED.`);
            return; // Only process APPROVED
        }

        console.log(`[AssetWorker] Processing APPROVED image: ${imageId}`);

        // 1. BG Remove
        const noBgUrl = await simulateBGRemove(image.imageUrl || 'mock_url');
        console.log(`[AssetWorker] BG Removed -> ${noBgUrl}`);

        // 2. Upscale (Scale 4, mode design)
        const upscaledUrl = await simulateUpscale(noBgUrl, 4, 'design');
        console.log(`[AssetWorker] Upscaled -> ${upscaledUrl}`);

        // 3. Normalize & Create Master
        const masterFileUrl = await createNormalizedMaster(upscaledUrl, imageId);
        console.log(`[AssetWorker] Master created -> ${masterFileUrl}`);

        // 4. Generate Mockups (Real files via Sharp)
        console.log(`[AssetWorker] Generating Mockups...`);
        const mockupDefinitions = [
            { name: 'mockup1', templateId: 'flatlay_01', bgColor: '#2d2d2d', label: 'T-Shirt Flatlay' },
            { name: 'mockup2', templateId: 'model_01', bgColor: '#1a1a2e', label: 'Model Mockup' }
        ];
        const mockupsData = [];
        for (const def of mockupDefinitions) {
            const mockupFilename = `${imageId}_${def.name}.png`;
            const mockupFilepath = path.join(outputDir, mockupFilename);
            await sharp({
                create: { width: 1200, height: 1500, channels: 4, background: def.bgColor }
            })
                .composite([{
                    input: Buffer.from(`<svg width="1000" height="1000"><rect x="0" y="0" width="1000" height="1000" fill="${def.bgColor}" rx="20"/><text x="50%" y="45%" dominant-baseline="middle" text-anchor="middle" font-size="60" fill="#fff">${def.label}</text><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-size="30" fill="#aaa">${imageId.substring(0, 8)}</text></svg>`),
                    top: 250, left: 100
                }])
                .png()
                .toFile(mockupFilepath);
            mockupsData.push({ mockupUrl: `assets/outputs/${mockupFilename}`, templateId: def.templateId });
        }

        // 5. Generate SEO Data (Synthetic)
        console.log(`[AssetWorker] Generating SEO Data...`);
        const seoData = {
            title: "Premium Vintage Graphic T-Shirt",
            description: "High quality graphic tee. Perfect addition to your wardrobe.",
            tags: ["vintage", "graphic tee", "apparel", "design"]
        };

        // 6. Delete old mockups and seo to prevent constraint errors on retry
        await prisma.mockup.deleteMany({ where: { imageId } });
        await prisma.sEOData.deleteMany({ where: { imageId } });

        // 7. LEGAL GUARD KONTROLÜ
        const safety = await safetyService.validateLegalSafety(seoData);

        if (!safety.isSafe) {
            console.error(`[AssetWorker] 🚔 LEGAL GUARD UYARISI: Image ${imageId} ban riski taşıyor!`);
            
            // Eğer ihlal varsa: durumu 'FLAGGED' yap ve gerekçeyi yazarak iptal et
            await prisma.image.update({
                where: { id: imageId },
                data: {
                    masterFileUrl,
                    status: 'FLAGGED',
                    flagReason: safety.reason,
                    seoData: { create: seoData },
                    mockups: { create: mockupsData }
                }
            });

            const taskService = require('../services/task.service');
            await taskService.incrementTask('GENERATION');
            
            return { masterFileUrl, mockups: mockupsData.length, hasSeo: true, flagged: true, reason: safety.reason };
        }

        // 8. Update DB with all pipeline assets (PENDING_APPROVAL)
        await prisma.image.update({
            where: { id: imageId },
            data: {
                masterFileUrl,
                status: 'PENDING_APPROVAL',
                flagReason: null,
                seoData: { create: seoData },
                mockups: { create: mockupsData }
            }
        });

        console.log(`[AssetWorker] Successfully processed image ${imageId} -> PENDING_APPROVAL (Kalite Kontrol bekleniyor)`);
        
        // Increment Generation task progress
        const taskService = require('../services/task.service');
        await taskService.incrementTask('GENERATION');

        return { masterFileUrl, mockups: mockupsData.length, hasSeo: true, drafted: false, pendingApproval: true };

    } catch (err) {
        console.error(`[AssetWorker] Error processing image ${imageId}:`, err);
        // Change status to FAILED as requested
        await prisma.image.update({
            where: { id: imageId },
            data: { status: 'FAILED' }
        });
        throw err;
    }
}

const worker = new Worker('asset-processing', processAsset, {
    connection: redisConnection,
    concurrency: 2,
});

worker.on('active', (job) => {
    console.log(`[AssetWorker] ▶  İş başladı  | jobId=${job.id} | imageId=${job.data.imageId}`);
});

worker.on('completed', (job, result) => {
    const mockupCount = result?.mockups ?? 0;
    console.log(`[AssetWorker] ✓  İş tamamlandı | jobId=${job.id} | imageId=${job.data.imageId} | mockups=${mockupCount}`);
});

worker.on('failed', (job, err) => {
    console.error(`[AssetWorker] ✗  İş başarısız | jobId=${job?.id} | imageId=${job?.data?.imageId} | hata=${err.message}`);
});

worker.on('stalled', (jobId) => {
    console.warn(`[AssetWorker] ⚠  İş takıldı (stalled) | jobId=${jobId}`);
});

worker.on('error', (err) => {
    console.error('[AssetWorker] Worker hatası:', err.message);
});

console.log('[AssetWorker] ✔  Kuyruk dinleniyor → asset-processing');

module.exports = { worker, processAsset };
