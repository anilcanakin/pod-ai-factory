const { PrismaClient } = require('@prisma/client');
const fetch = require('node-fetch');

async function testFactoryPush() {
    console.log("=== Sprint 5: Ideas Factory Push Test ===");
    const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

    try {
        console.log("1. Injecting a mock Approved Idea...");
        const idea = await prisma.idea.create({
            data: {
                niche: "developer_humor",
                mainKeyword: "funny coding shirt",
                persona: "backend engineer",
                hook: "It works on my machine",
                iconFamily: ["computer", "coffee"],
                styleEnum: "modern_minimalist",
                status: "APPROVED"
            }
        });
        console.log("Mock idea created:", idea.id);

        console.log("\n2. Pushing to Factory (/api/ideas/:id/factory)...");
        const facRes = await fetch(`http://localhost:3000/api/ideas/${idea.id}/factory`, { method: 'POST' });
        const facData = await facRes.json();

        console.log("Factory Push Result:", facData);

        // Verify Synthesized Vision Data
        const vision = await prisma.visionAnalysis.findFirst({ where: { jobId: facData.jobId } });
        if (vision) {
            console.log("✅ Verified Synthesized Vision derived from Idea:", vision.parsedVisionJson);
        } else {
            console.error("❌ Failed to find Vision record mapped to new job.");
        }

    } catch (err) {
        console.error("Test Error:", err);
    } finally {
        await prisma.$disconnect();
    }
}

testFactoryPush();
