const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } }
});

async function runTests() {
    console.log("=== Starting Sprint 2 End-to-End Test ===");
    try {
        // 1. Create a DesignJob directly in DB for the test
        const job = await prisma.designJob.create({
            data: {
                originalImage: 'assets/references/USA250.jpg',
                status: 'PENDING'
            }
        });
        const jobId = job.id;
        console.log(`[+] Created Job ID: ${jobId}`);

        // 2. Vision Test
        console.log("\n[+] Testing 1) /api/vision/analyze ...");
        const form = new FormData();
        form.append('image', new Blob([fs.readFileSync('assets/references/USA250.jpg')]), 'USA250.jpg');
        form.append('jobId', jobId);

        let res = await fetch('http://localhost:3000/api/vision/analyze', {
            method: 'POST',
            body: form
        });
        const visionJson = await res.json();
        console.log("Vision Output:", JSON.stringify(visionJson, null, 2));

        // 3. Prompt Synth
        console.log("\n[+] Testing 2) /api/prompt/synthesize ...");
        res = await fetch('http://localhost:3000/api/prompt/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId })
        });
        const synthJson = await res.json();
        console.log("Synth Output:", JSON.stringify(synthJson, null, 2));

        // 4. Variations
        console.log("\n[+] Testing 3) /api/prompt/variations ...");
        res = await fetch('http://localhost:3000/api/prompt/variations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId, count: 30 })
        });
        const varJson = await res.json();
        console.log(`Variations Created: ${varJson.length} prompts`);

        // 5. Generation Runner
        console.log("\n[+] Testing 4) /api/generate/run ...");
        // For testing locally without spamming OpenAI and spending too much, we will pass count: 2
        res = await fetch('http://localhost:3000/api/generate/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId, count: 2 })
        });
        const genJson = await res.json();
        console.log(`Images Generated: ${genJson.length}`);

        // 6. Gallery List
        console.log("\n[+] Testing 5) /api/gallery/:jobId ...");
        res = await fetch(`http://localhost:3000/api/gallery/${jobId}`);
        const galleryJson = await res.json();
        console.log(`Gallery Images Found: ${galleryJson.length}`);

        // 7. Approve / Reject
        if (galleryJson.length > 0) {
            const firstImageId = galleryJson[0].id;
            console.log(`\n[+] Testing Approve on image ${firstImageId} ...`);
            res = await fetch(`http://localhost:3000/api/gallery/${firstImageId}/approve`, { method: 'POST' });
            const approveJson = await res.json();
            console.log(`Approve Result Status: ${approveJson.status}, isApproved: ${approveJson.isApproved}`);
        }

        console.log("\n=== All Tests Completed Successfully ===");
    } catch (err) {
        console.error("Test failed:", err);
    } finally {
        await prisma.$disconnect();
    }
}

runTests();
