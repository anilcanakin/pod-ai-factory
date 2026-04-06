const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:3000/api';

async function run() {
    console.log('=========================================');
    console.log('POD AI Factory — Etsy Mode Test');
    console.log('=========================================\n');

    let cookie = '';

    // 1. Login
    console.log('[1/5] Login...');
    try {
        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'test@pod-factory.com', password: 'dev-token-2024' })
        });
        const data = await loginRes.json();
        if (!data.ok) throw new Error(data.error);
        cookie = loginRes.headers.get('set-cookie').split(';')[0];
        console.log(`✅ Login SUCCESS. Workspace: ${data.workspaceId}`);
    } catch (err) {
        console.error('❌ Login FAILED:', err.message);
        process.exit(1);
    }

    // 2. Run Etsy Mode
    console.log('\n[2/5] Running Etsy Mode (keyword="vintage camping", niche="outdoor_camping", style="vintage")...');
    let jobId = '';
    try {
        const res = await fetch(`${BASE_URL}/factory/etsy-mode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
            body: JSON.stringify({
                keyword: 'vintage camping',
                niche: 'outdoor_camping',
                style: 'vintage',
                designCount: 2  // use 2 for test speed
            })
        });
        const data = await res.json();
        if (res.status !== 200) throw new Error(data.error || `HTTP ${res.status}`);
        jobId = data.jobId;
        console.log(`✅ Etsy Mode completed. Job: ${jobId}, Designs: ${data.designsGenerated}/${data.designsRequested}`);
    } catch (err) {
        console.error('❌ Etsy Mode FAILED:', err.message);
        process.exit(1);
    }

    // 3. Wait for pipeline processing
    console.log('\n[3/5] Waiting for pipeline processing (60s max)...');
    let pipeDone = false;
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const res = await fetch(`${BASE_URL}/pipeline/status/${jobId}`, { headers: { 'Cookie': cookie } });
        if (res.status === 200) {
            const images = await res.json();
            const processed = images.filter(img => img.status === 'PROCESSED');
            if (processed.length > 0) {
                pipeDone = true;
                console.log(`\n✅ Pipeline processed ${processed.length} images.`);
                break;
            }
        }
        process.stdout.write('.');
    }
    if (!pipeDone) {
        console.error('\n❌ Pipeline timed out.');
        process.exit(1);
    }

    // 4. Generate Etsy CSV
    console.log('\n[4/5] Generating Etsy CSV...');
    try {
        const res = await fetch(`${BASE_URL}/export/etsy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
            body: JSON.stringify({ jobId })
        });
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        console.log('✅ CSV Generated.');
    } catch (err) {
        console.error('❌ CSV FAILED:', err.message);
        process.exit(1);
    }

    // 5. Download and verify ZIP
    console.log('\n[5/5] Downloading & verifying bundle...');
    try {
        const AdmZip = require('adm-zip');
        const res = await fetch(`${BASE_URL}/export/job/${jobId}/bundle`, { headers: { 'Cookie': cookie } });
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const zip = new AdmZip(buf);
        const entries = zip.getEntries().map(e => e.entryName);
        console.log(`ZIP contains: ${entries.join(', ')}`);

        const required = ['seo.json', 'listing.csv'];
        const missing = required.filter(f => !entries.includes(f));
        if (missing.length > 0) throw new Error(`Missing: ${missing.join(', ')}`);

        // Check for at least one design and mockup
        const hasDesign = entries.some(e => e.includes('design_'));
        const hasMockup = entries.some(e => e.includes('mockup'));
        if (!hasDesign) throw new Error('No design file found in ZIP');
        if (!hasMockup) throw new Error('No mockup file found in ZIP');

        console.log('✅ Bundle verified!');
    } catch (err) {
        console.error('❌ Bundle verification FAILED:', err.message);
        process.exit(1);
    }

    console.log('\n🎉 ETSY MODE TEST PASSED!');
}

run();
