const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

async function testSprint4() {
    console.log("=== Sprint 4: Factory Run & Zip Bundle Test ===");
    try {
        console.log("1. Starting Tek Tuş /api/factory/run");
        const factoryRes = await fetch('http://localhost:3000/api/factory/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                referenceImageId: 'assets/references/USA250.jpg',
                generateCount: 3,
                variationCount: 5,
                autoApprove: true
            })
        });

        const factoryData = await factoryRes.json();
        console.log("Factory Run Data:", factoryData);

        if (factoryData.error) throw new Error(factoryData.error);
        const jobId = factoryData.jobId;

        console.log(`\n2. Job initialized and auto-approved. Waiting a moment...`);
        await new Promise(res => setTimeout(res, 2000));

        // Trigger the pipeline for the approved ones
        console.log("3. Triggering Asset Pipeline for APPROVED items...");

        const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
        const approvedImages = await prisma.image.findMany({ where: { jobId, status: 'APPROVED' } });

        if (approvedImages.length > 0) {
            const imgId = approvedImages[0].id;
            console.log(`Pipeline triggering for image: ${imgId}`);
            const pipelineRes = await fetch('http://localhost:3000/api/pipeline/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageId: imgId })
            });
            const pText = await pipelineRes.text();
            console.log("Pipeline result:", pText.substring(0, 500));
        } else {
            console.log("No approved images found to pipeline.");
        }

        console.log(`\n4. Fetching Output Bundle for Job ${jobId}...`);
        const bundleRes = await fetch(`http://localhost:3000/api/export/job/${jobId}/bundle`);

        if (bundleRes.ok) {
            const dest = path.join(__dirname, `../assets/outputs/test_bundle_${jobId}.zip`);
            const fileStream = fs.createWriteStream(dest);
            await new Promise((resolve, reject) => {
                bundleRes.body.pipe(fileStream);
                bundleRes.body.on("error", reject);
                fileStream.on("finish", resolve);
            });
            console.log(`✅ Bundle downloaded successfully to: ${dest}`);
        } else {
            console.error("Bundle Download Failed:", await bundleRes.text());
        }

        await prisma.$disconnect();
    } catch (err) {
        console.error("Test Error:", err);
    }
}

testSprint4();
