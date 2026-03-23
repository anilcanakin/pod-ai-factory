const fetch = require('node-fetch');
const AdmZip = require('adm-zip');

const BASE_URL = 'http://localhost:3000/api';

async function run() {
    console.log('=========================================');
    console.log('POD AI Factory FULL Smoke Test');
    console.log('=========================================\n');

    let cookie = '';
    let cookie2 = '';
    let workspaceId = '';

    // 1. Login Primary User
    console.log('[1/10] Testing Authentication (Primary User)...');
    try {
        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'test@pod-factory.com', password: 'dev-token-2024' })
        });
        const loginData = await loginRes.json();
        if (!loginData.ok) throw new Error(loginData.error);

        cookie = loginRes.headers.get('set-cookie').split(';')[0];
        workspaceId = loginData.workspaceId;
        console.log(`✅ Login SUCCESS. WorkspaceId: ${workspaceId}`);
    } catch (err) {
        console.error('❌ Login FAILED:', err.message);
        process.exit(1);
    }

    // 2. Login Secondary User for Audit
    console.log('\n[2/10] Testing Authentication (Secondary User)...');
    try {
        const loginRes2 = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'test2@pod-factory.com', password: 'dev-token-2024' })
        });
        const loginData2 = await loginRes2.json();
        if (!loginData2.ok) throw new Error(loginData2.error);

        cookie2 = loginRes2.headers.get('set-cookie').split(';')[0];
        console.log(`✅ Secondary Login SUCCESS. WorkspaceId: ${loginData2.workspaceId}`);
    } catch (err) {
        console.error('❌ Secondary Login FAILED:', err.message);
        process.exit(1);
    }

    // 3. Factory Run
    console.log('\n[3/10] Starting Factory Run (1 image)...');
    let jobId = '';
    try {
        const runRes = await fetch(`${BASE_URL}/factory/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
            body: JSON.stringify({
                referenceImageId: 'assets/references/USA250.jpg',
                generateCount: 1,
                variationCount: 1,
                visionData: {
                    style: "Testing Style",
                    palette: ["Red"],
                    palette_hex: ["#ff0000"],
                    composition: "Test Comp",
                    icon_family: ["Icons"],
                    text_layout: "Layout",
                    niche_guess: "Smoke Test Niche"
                },
                variationTypes: [{ name: "text" }]
            })
        });
        const runData = await runRes.json();
        if (runRes.status !== 200) {
            console.error(`HTTP Error ${runRes.status}:`, runData);
            throw new Error(runData.error || 'Factory Run Failed');
        }
        jobId = runData.jobId;
        console.log(`✅ Factory Run Started. Job ID: ${jobId}`);
    } catch (err) {
        console.error('❌ Factory Run FAILED:', err.message);
        process.exit(1);
    }

    // 4. Polling for generation
    console.log('\n[4/10] Waiting for generation (polling 120s max)...');
    let imageId = null;
    let done = false;
    for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const galRes = await fetch(`${BASE_URL}/gallery/${jobId}`, { headers: { 'Cookie': cookie } });
        const images = await galRes.json();
        if (images.length > 0) {
            const img = images[0];
            if (['COMPLETED', 'FAILED', 'REJECTED'].includes(img.status)) {
                if (img.status === 'COMPLETED') {
                    console.log(`✅ Image generated successfully. Cost: ${img.cost}`);
                    imageId = img.id;
                } else {
                    console.error(`⚠️ Image generated but status is ${img.status}. Check rawResponse.`);
                }
                done = true;
                break;
            }
        }
        process.stdout.write('.');
    }
    if (!done) {
        console.error('\n❌ Gallery polling timed out without completion.');
        process.exit(1);
    }

    // 5. Approve Image
    console.log('\n[5/10] Approving Image...');
    try {
        const appRes = await fetch(`${BASE_URL}/gallery/${imageId}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookie }
        });
        if (appRes.status !== 200) throw new Error(`HTTP ${appRes.status}`);
        console.log('✅ Image Approved.');
    } catch (err) {
        console.error('❌ Image Approval FAILED:', err.message);
        process.exit(1);
    }

    // 6. trigger pipeline
    console.log('\n[6/10] Triggering Assets Pipeline...');
    try {
        const pipeRes = await fetch(`${BASE_URL}/pipeline/run-job/${jobId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookie }
        });
        if (pipeRes.status !== 200 && pipeRes.status !== 400) {
            throw new Error(`HTTP ${pipeRes.status}`);
        }
        console.log('✅ Pipeline Triggered.');
    } catch (err) {
        console.error('❌ Pipeline Trigger FAILED:', err.message);
        process.exit(1);
    }

    // 7. Wait for Pipeline processing
    console.log('\n[7/10] Waiting for Pipeline processing (polling 90s max)...');
    let pipeDone = false;
    for (let i = 0; i < 45; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const pipeStatRes = await fetch(`${BASE_URL}/pipeline/status/${jobId}`, { headers: { 'Cookie': cookie } });
        if (pipeStatRes.status === 200) {
            const data = await pipeStatRes.json();
            if (data && data.length > 0) {
                const failed = data.filter(img => img.status === 'FAILED');
                if (failed.length > 0) {
                    throw new Error('Pipeline Worker FAILED processing an image.');
                }
                const pending = data.filter(img => img.status === 'APPROVED' || img.status === 'PROCESSING');
                if (pending.length === 0) {
                    const processed = data.filter(img => img.status === 'PROCESSED');
                    if (processed.length > 0) {
                        pipeDone = true;
                        console.log(`\n✅ Pipeline successfully PROCESSED images.`);
                        break;
                    }
                }
            }
        }
        process.stdout.write('.');
    }
    if (!pipeDone) {
        console.error('\n❌ Pipeline polling timed out without completion.');
        process.exit(1);
    }

    // 8. Generate Etsy CSV
    console.log('\n[8/13] Generating Etsy CSV (Listings)...');
    try {
        const etsyRes = await fetch(`${BASE_URL}/export/etsy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
            body: JSON.stringify({ jobId })
        });
        if (etsyRes.status !== 200) {
            const errBody = await etsyRes.text();
            throw new Error(`HTTP ${etsyRes.status}: ${errBody}`);
        }
        console.log('✅ Etsy CSV Generated.');
    } catch (err) {
        console.error('❌ Etsy CSV Generation FAILED:', err.message);
        process.exit(1);
    }

    // 9. Create Mockup Template (upload base image)
    console.log('\n[9/13] Creating Mockup Template...');
    let templateId = '';
    try {
        // Create a simple test PNG using canvas or a tiny valid PNG buffer
        const { createCanvas } = require('canvas');
        const canvas = createCanvas(800, 1000);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#2d2d2d';
        ctx.fillRect(0, 0, 800, 1000);
        ctx.fillStyle = '#ffffff';
        ctx.font = '30px sans-serif';
        ctx.fillText('TEST MOCKUP', 250, 500);
        const pngBuffer = canvas.toBuffer('image/png');

        const FormData = require('form-data');
        const fd = new FormData();
        fd.append('baseImage', pngBuffer, { filename: 'base.png', contentType: 'image/png' });
        fd.append('name', 'Smoke Test Mockup');
        fd.append('category', 'tshirt');
        fd.append('configJson', JSON.stringify({
            transform: {
                rotation: 0,
                opacity: 0.92,
                blendMode: 'multiply',
            },
            render: {
                renderMode: 'flat',
                displacementMapPath: null,
                perspective: null,
            },
            meta: {
                view: 'front',
                background: 'studio',
                color: 'white',
                hasHumanModel: false,
            },
        }));

        const tmplRes = await fetch(`${BASE_URL}/mockups/templates`, {
            method: 'POST',
            headers: { ...fd.getHeaders(), 'Cookie': cookie },
            body: fd
        });

        if (tmplRes.status !== 200) {
            const errBody = await tmplRes.text();
            throw new Error(`HTTP ${tmplRes.status}: ${errBody}`);
        }
        const tmplData = await tmplRes.json();
        templateId = tmplData.id;
        console.log(`✅ Mockup Template created: ${templateId}`);
    } catch (err) {
        console.error('❌ Mockup Template Creation FAILED:', err.message);
        process.exit(1);
    }

    // 10. Render Mockup
    console.log('\n[10/13] Rendering Mockup...');
    try {
        const renderRes = await fetch(`${BASE_URL}/mockups/render`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
            body: JSON.stringify({ imageId, templateId })
        });
        if (renderRes.status !== 200) {
            const errBody = await renderRes.text();
            throw new Error(`HTTP ${renderRes.status}: ${errBody}`);
        }
        const renderData = await renderRes.json();
        console.log(`✅ Mockup rendered: ${renderData.mockupUrl}`);
    } catch (err) {
        console.error('❌ Mockup Render FAILED:', err.message);
        process.exit(1);
    }

    // 11. Workspace Isolation Audit
    console.log('\n[11/13] Auditing Workspace Isolation (Cross-tenant access)...');
    try {
        const auditRes = await fetch(`${BASE_URL}/export/job/${jobId}/bundle`, {
            headers: { 'Cookie': cookie2 } // using second user's cookie
        });
        if (auditRes.status === 404 || auditRes.status === 401 || auditRes.status === 403) {
            console.log(`✅ Cross-tenant access successfully blocked (HTTP ${auditRes.status}).`);
        } else {
            throw new Error(`Workspace Isolation FAILED! Expected 404/403 but got HTTP ${auditRes.status}`);
        }
    } catch (err) {
        console.error('❌ Workspace Isolation Audit FAILED:', err.message);
        process.exit(1);
    }

    // 12. Verify Export Bundle Contents (now includes rendered mockup)
    console.log('\n[12/13] Generating & Verifying Export Bundle ZIP...');
    try {
        const exportRes = await fetch(`${BASE_URL}/export/job/${jobId}/bundle`, {
            headers: { 'Cookie': cookie }
        });
        if (exportRes.status !== 200) {
            const errBody = await exportRes.text();
            throw new Error(`HTTP ${exportRes.status}: ${errBody}`);
        }
        const arrayBuffer = await exportRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        console.log(`✅ Bundle downloaded. Size: ${(buffer.length / 1024).toFixed(2)} KB`);

        // Parse ZIP
        const zip = new AdmZip(buffer);
        const zipEntries = zip.getEntries();
        const entryNames = zipEntries.map(e => e.entryName);

        console.log(`✅ ZIP successfully parsed. Contains ${zipEntries.length} files:`);
        entryNames.forEach(n => console.log(`   - ${n}`));

        // Verify EXACT expected files — now uses folder structure
        const hasDesign = entryNames.some(e => e.startsWith('designs/'));
        const hasMockup = entryNames.some(e => e.startsWith('mockups/'));
        const hasSeo = entryNames.some(e => e.startsWith('seo/'));
        const hasListing = entryNames.includes('listing.csv');

        const missing = [];
        if (!hasDesign) missing.push('designs/');
        if (!hasMockup) missing.push('mockups/');
        if (!hasSeo) missing.push('seo/');
        if (!hasListing) missing.push('listing.csv');

        if (missing.length > 0) {
            throw new Error(`ZIP is missing: ${missing.join(', ')}. Found: ${entryNames.join(', ')}`);
        }

        console.log(`✅ ZIP structure verified: designs/ ✓, mockups/ ✓, seo/ ✓, listing.csv ✓`);

        // Validate seo.json is valid JSON
        const seoEntry = zip.getEntry('seo/seo.json');
        if (!seoEntry) throw new Error('seo/seo.json not found in ZIP');
        const seoContent = JSON.parse(seoEntry.getData().toString('utf8'));

        if (!Array.isArray(seoContent) || seoContent.length === 0) {
            throw new Error('seo.json is empty or not an array.');
        }
        console.log(`✅ seo.json validated: ${seoContent.length} SEO record(s).`);

        // Validate listing.csv is not empty
        const csvEntry = zip.getEntry('listing.csv');
        const csvContent = csvEntry.getData().toString('utf8');
        if (csvContent.trim().length < 10) {
            throw new Error('listing.csv is empty or too short.');
        }
        console.log(`✅ listing.csv validated: ${csvContent.split('\n').length} rows.`);

    } catch (err) {
        console.error('❌ Export Bundle Verification FAILED:', err.message);
        process.exit(1);
    }

    // 13. Mockup Template Workspace Isolation
    console.log('\n[13/13] Auditing Mockup Template Workspace Isolation...');
    try {
        const auditRes = await fetch(`${BASE_URL}/mockups/templates/${templateId}`, {
            headers: { 'Cookie': cookie2 }
        });
        if (auditRes.status === 404 || auditRes.status === 401 || auditRes.status === 403) {
            console.log(`✅ Cross-tenant template access blocked (HTTP ${auditRes.status}).`);
        } else {
            throw new Error(`Template Isolation FAILED! Expected 404/403 but got HTTP ${auditRes.status}`);
        }
    } catch (err) {
        console.error('❌ Template Isolation Audit FAILED:', err.message);
        process.exit(1);
    }

    console.log('\n🎉 ALL FULL E2E SMOKE TESTS PASSED!');
}

run();
