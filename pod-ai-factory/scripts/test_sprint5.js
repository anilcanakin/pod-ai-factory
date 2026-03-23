const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

async function testSprint5() {
    console.log("=== Sprint 5: Ideas Engine Test ===");
    try {
        const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

        console.log("1. Simulating CSV Upload -> /api/ideas/generate");

        // Construct standard multipart/form-data for native fetch
        const filePath = path.join(__dirname, '../assets/uploads/mock_everbee.csv');
        const fileContent = fs.readFileSync(filePath);

        const formData = new FormData();
        formData.append('file', new Blob([fileContent], { type: 'text/csv' }), 'mock_everbee.csv');

        const genRes = await fetch('http://localhost:3000/api/ideas/generate', {
            method: 'POST',
            body: formData,
        });

        const textResponse = await genRes.text();
        let genData = {};
        try {
            genData = JSON.parse(textResponse);
        } catch (e) { }
        console.log(`Generated Response:`, genData.message || textResponse);

        console.log("\n2. Approving the first idea and pushing to Factory (/api/ideas/:id/factory)...");
        const ideas = await prisma.idea.findMany({ where: { status: 'PENDING' } });

        if (ideas.length > 0) {
            const testIdeaId = ideas[0].id;

            // Approve Idea
            await fetch(`http://localhost:3000/api/ideas/${testIdeaId}/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'APPROVED' })
            });

            // Push to factory
            const facRes = await fetch(`http://localhost:3000/api/ideas/${testIdeaId}/factory`, {
                method: 'POST'
            });

            const facData = await facRes.json();
            console.log("Factory Push Result:", facData);

            // Check if Job effectively registered its synthesized vision
            const vision = await prisma.visionAnalysis.findFirst({ where: { jobId: facData.jobId } });
            console.log("Synthesized Vision derived from Idea:", vision.parsedVisionJson);
        } else {
            console.log("No pending ideas generated to push.");
        }

        await prisma.$disconnect();
    } catch (err) {
        console.error("Test Error:", err);
    }
}

testSprint5();
