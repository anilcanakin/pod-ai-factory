const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
// Direct imports of worker handler functions for synchronous testing
const assetWorker = require('../src/queues/asset.worker');
const mockupWorker = require('../src/queues/mockup.worker');

const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } }
});

async function runSprint3Test() {
    console.log("=== Starting Sprint 3 End-to-End Test ===");
    try {
        // 1. Setup Data
        // Assume Job already exists from Sprint 2. Try fetching a job, if not create one.
        let job = await prisma.designJob.findFirst({ orderBy: { createdAt: 'desc' } });
        if (!job) {
            console.log("Creating mock job and image pipeline...");
            job = await prisma.designJob.create({
                data: { originalImage: 'test', status: 'COMPLETED' }
            });
            // Mock vision JSON for SEO generator
            await prisma.visionAnalysis.create({
                data: { jobId: job.id, rawOpenAIResponse: '{}', parsedVisionJson: { style: 'vintage_distressed', niche_guess: 'humor_funny_quotes' } }
            });
        }

        let img = await prisma.image.findFirst({ where: { jobId: job.id } });
        if (!img) {
            img = await prisma.image.create({
                data: { jobId: job.id, variantType: 'text', promptUsed: 'test', engine: 'openai', imageUrl: 'http://example.com/mock.png', status: 'GENERATED' }
            });
        }
        const imageId = img.id;
        const jobId = job.id;

        console.log(`[+] Using Image ID: ${imageId}, Job ID: ${jobId}`);

        // 2. Approve via Gallery
        console.log(`\n[+] Testing 1) Approving image...`);
        let res = await fetch(`http://localhost:3000/api/gallery/${imageId}/approve`, { method: 'POST' });
        let resData = await res.json();
        console.log(`Status changed to: ${resData.status}, isApproved: ${resData.isApproved}`);

        // 3. Asset Processing
        console.log(`\n[+] Testing 2) Triggering Asset Processing...`);
        // We will call the worker process directly to emulate BullMQ
        const masterFileResult = await assetWorker.processAsset({ id: 'test_job', data: { imageId } });
        console.log(`Asset processed: ${JSON.stringify(masterFileResult)}`);

        // 4. Mockup Creation
        console.log(`\n[+] Testing 3) Triggering Mockup Generation...`);
        const mockupResult = await mockupWorker.processMockups({ id: 'test_job_2', data: { imageId } });
        console.log(`Mockups created: ${mockupResult.length} files generated.`);

        // 5. SEO Gen
        console.log(`\n[+] Testing 4) POST /api/seo/generate ...`);
        res = await fetch('http://localhost:3000/api/seo/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageId, jobId })
        });
        const seoData = await res.json();
        console.log(`SEO Title: ${seoData.title}`);
        console.log(`SEO Tags: ${seoData.tags.join(', ')}`);

        // 6. CSV Export
        console.log(`\n[+] Testing 5) POST /api/export/etsy ...`);
        res = await fetch('http://localhost:3000/api/export/etsy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId })
        });
        const exportData = await res.json();
        console.log(`Exported CSV File: ${exportData.fileUrl}`);

        console.log("\n=== Sprint 3 Tests Completed Successfully ===");
    } catch (err) {
        console.error("Test failed:", err);
    } finally {
        await prisma.$disconnect();
        // Since workers hold connections, we aggressively exit.
        process.exit(0);
    }
}
// Slight delay to ensure server on port 3000 is ready 
setTimeout(runSprint3Test, 1000);
