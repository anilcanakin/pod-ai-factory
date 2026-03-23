const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:3000/api';

async function run() {
    console.log('=========================================');
    console.log('POD AI Factory — Product Pack Test');
    console.log('=========================================\n');

    let cookie = '';

    // 1. Login
    console.log('[1/5] Login...');
    try {
        const res = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'test@pod-factory.com', password: 'dev-token-2024' })
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        cookie = res.headers.get('set-cookie').split(';')[0];
        console.log(`✅ Login SUCCESS.`);
    } catch (err) {
        console.error('❌ Login FAILED:', err.message);
        process.exit(1);
    }

    // 2. List available products
    console.log('\n[2/5] Listing available products...');
    try {
        const res = await fetch(`${BASE_URL}/packs/products`, { headers: { 'Cookie': cookie } });
        const products = await res.json();
        console.log(`✅ Available products: ${products.map(p => p.label).join(', ')}`);
    } catch (err) {
        console.error('❌ Products list FAILED:', err.message);
        process.exit(1);
    }

    // 3. Create a pack (T-Shirt + Mug)
    console.log('\n[3/5] Creating pack (T-Shirt + Mug)...');
    let packId = '';
    try {
        const res = await fetch(`${BASE_URL}/packs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
            body: JSON.stringify({
                name: 'Test Pack',
                productTypes: ['tshirt', 'mug']
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        packId = data.id;
        console.log(`✅ Pack created: ${packId} with ${data.items.length} products.`);
    } catch (err) {
        console.error('❌ Pack creation FAILED:', err.message);
        process.exit(1);
    }

    // 4. We need an approved image. Run a quick factory job.
    console.log('\n[4/5] Creating test image for pack run...');
    let imageId = '';
    try {
        // Start factory
        const runRes = await fetch(`${BASE_URL}/factory/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
            body: JSON.stringify({
                referenceImageId: 'assets/references/USA250.jpg',
                generateCount: 1, variationCount: 1,
                visionData: { style: "Test", palette: ["Red"], palette_hex: ["#ff0000"], composition: "Test", icon_family: ["Icons"], text_layout: "Layout", niche_guess: "Test" },
                variationTypes: [{ name: "text" }]
            })
        });
        const runData = await runRes.json();
        const jobId = runData.jobId;

        // Wait for generation
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const galRes = await fetch(`${BASE_URL}/gallery/${jobId}`, { headers: { 'Cookie': cookie } });
            const images = await galRes.json();
            if (images.length > 0 && images[0].status === 'COMPLETED') {
                imageId = images[0].id;
                break;
            }
            process.stdout.write('.');
        }
        if (!imageId) throw new Error('Image generation timed out');

        // Approve image
        await fetch(`${BASE_URL}/gallery/${imageId}/approve`, {
            method: 'POST', headers: { 'Cookie': cookie }
        });

        // Run pipeline
        await fetch(`${BASE_URL}/pipeline/run-job/${jobId}`, {
            method: 'POST', headers: { 'Cookie': cookie }
        });

        // Wait for processing
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const res = await fetch(`${BASE_URL}/pipeline/status/${jobId}`, { headers: { 'Cookie': cookie } });
            const imgs = await res.json();
            if (imgs.some(img => img.status === 'PROCESSED')) break;
            process.stdout.write('.');
        }

        console.log(`\n✅ Test image ready: ${imageId}`);
    } catch (err) {
        console.error('\n❌ Test image setup FAILED:', err.message);
        process.exit(1);
    }

    // 5. Run pack pipeline
    console.log('\n[5/5] Running pack pipeline...');
    try {
        const res = await fetch(`${BASE_URL}/packs/${packId}/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
            body: JSON.stringify({ imageId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        console.log(`✅ Pack pipeline completed: ${data.mockups.length} product mockups generated.`);
        data.mockups.forEach(m => console.log(`   - ${m.productType}: ${m.mockupUrl}`));
    } catch (err) {
        console.error('❌ Pack pipeline FAILED:', err.message);
        process.exit(1);
    }

    console.log('\n🎉 PRODUCT PACK TEST PASSED!');
}

run();
