const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const FormData = require('form-data');
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

async function testSprint6() {
    console.log("=== Sprint 6: Analytics & Feedback Loop Test ===");

    try {
        // 1. Create Mock Job and Images
        const job = await prisma.designJob.create({
            data: { originalImage: "SPRINT6-MOCK", status: "COMPLETED" }
        });

        const modelData = (url) => ({
            jobId: job.id,
            imageUrl: url,
            status: "COMPLETED",
            isApproved: true,
            variantType: "mock",
            promptUsed: "mock",
            engine: "mock"
        });

        const imgWinner = await prisma.image.create({ data: modelData("mock_winner.png") });
        const imgLow = await prisma.image.create({ data: modelData("mock_low.png") });
        const imgNorm = await prisma.image.create({ data: modelData("mock_norm.png") });

        console.log("Created Mock Images");
        console.log(`WINNER SKU: ${imgWinner.id}`);
        console.log(`LOW_SCORE SKU: ${imgLow.id}`);
        console.log(`NORMAL SKU: ${imgNorm.id}`);

        // 2. Generate CSV dynamically mapping to those Image IDs
        const csvContent = `SKU,Impressions,Visits,Favorites,Orders
${imgWinner.id},100,50,10,2
${imgLow.id},250,2,0,0
${imgNorm.id},100,10,2,0`;

        const csvPath = path.join(__dirname, '../assets/uploads/test_etsy_stats.csv');
        fs.writeFileSync(csvPath, csvContent);
        console.log("\nCreated Mock CSV with targeted Image SKUs.");

        // 3. Upload CSV
        const formData = new FormData();
        formData.append('file', fs.createReadStream(csvPath));

        console.log("\nUploading via /api/analytics/import...");
        const uploadRes = await fetch('http://localhost:3000/api/analytics/import', {
            method: 'POST',
            body: formData
        });
        const uploadData = await uploadRes.json();
        console.log(uploadData.message);

        // 4. Verify Performance Parsing and Rule logic
        console.log("\nFetching /api/analytics/performance Dashboard...");
        const perfRes = await fetch('http://localhost:3000/api/analytics/performance');
        const perfData = await perfRes.json();

        // Filter specifically for our mock IDs
        const sprint6Data = perfData.filter(p => [imgWinner.id, imgLow.id, imgNorm.id].includes(p.imageId));

        for (const pd of sprint6Data) {
            console.log(`\nSKU: ${pd.sku}`);
            console.log(`Stats -> Impressions: ${pd.impressions}, Visits: ${pd.visits}, Favs: ${pd.favorites}, Orders: ${pd.orders}`);
            console.log(`Score: ${pd.score}`);
            console.log(`Flag: ${pd.flag || 'NONE'}`);

            // Validations
            if (pd.sku === imgWinner.id && pd.flag !== 'WINNER') {
                console.error("❌ ERROR: WINNER flag missing.");
            } else if (pd.sku === imgLow.id && pd.flag !== 'LOW_SCORE') {
                console.error("❌ ERROR: LOW_SCORE flag missing.");
            }
        }

    } catch (e) {
        console.error("Test execution failed:", e);
    } finally {
        await prisma.$disconnect();
    }
}

testSprint6();
