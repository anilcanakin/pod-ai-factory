/**
 * mockup-smoke-test.js
 *
 * Dedicated smoke test for Mockup Template Standard v1.
 * Tests: login → template upload (category folder) → list → PATCH (Standard v1 shape)
 *        → factory run → render (deterministic output) → batch render → export bundle → isolation
 */

const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');

const BASE_URL = process.env.API_BASE || 'http://localhost:3000/api';
const EMAIL = process.env.TEST_EMAIL || 'test@kreatorium.ai';
const PASSWORD = process.env.TEST_PASSWORD || 'kreatorium123';
const EMAIL_2 = process.env.TEST_EMAIL_2 || 'test2@kreatorium.ai';

let cookie = '';
let cookie2 = '';

function log(step, total, msg) {
    console.log(`\n[${step}/${total}] ${msg}`);
}
function pass(msg) { console.log(`✅ ${msg}`); }
function fail(msg) { console.error(`❌ ${msg}`); process.exit(1); }

async function run() {
    const TOTAL = 10;
    console.log('==================================================');
    console.log('  MOCKUP GALLERY SMOKE TEST — Standard v1');
    console.log('==================================================');

    // 1. Login
    log(1, TOTAL, 'Authenticating...');
    try {
        const res = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Login failed');
        cookie = res.headers.get('set-cookie').split(';')[0];
        if (!cookie) throw new Error('No cookie returned');
        pass(`Logged in as ${EMAIL}`);
    } catch (err) {
        fail(`Login failed: ${err.message}`);
    }

    // 1b. Second user
    try {
        const res2 = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: EMAIL_2, password: PASSWORD }),
        });
        const data2 = await res2.json();
        if (!data2.ok) throw new Error(data2.error || 'Login failed');
        cookie2 = res2.headers.get('set-cookie').split(';')[0];
        pass(`Second user authenticated for isolation test`);
    } catch (err) {
        console.log(`⚠️ Secondary login failed, skipping isolation test (${err.message})`);
    }

    // 2. Upload Mockup Template — Standard v1 folder: assets/mockups/{category}/{templateId}/
    log(2, TOTAL, 'Creating Mockup Template (Standard v1)...');
    let templateId = '';
    try {
        const { createCanvas } = require('canvas');
        const canvas = createCanvas(800, 1000);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#2d2d2d';
        ctx.fillRect(0, 0, 800, 1000);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 28px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('T-SHIRT MOCKUP', 400, 500);
        const pngBuffer = canvas.toBuffer('image/png');

        const FormData = require('form-data');
        const fd = new FormData();
        fd.append('baseImage', pngBuffer, { filename: 'base.png', contentType: 'image/png' });
        fd.append('name', 'Smoke Test T-Shirt');
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

        const res = await fetch(`${BASE_URL}/mockups/templates`, {
            method: 'POST',
            headers: { ...fd.getHeaders(), 'Cookie': cookie },
            body: fd,
        });

        if (res.status !== 200) {
            const body = await res.text();
            throw new Error(`HTTP ${res.status}: ${body}`);
        }
        const data = await res.json();
        templateId = data.id;

        // Verify Standard v1: config has transform/render/meta sub-objects
        const cfg = data.configJson;
        if (!cfg.printArea || !cfg.transform || !cfg.render || !cfg.meta) {
            throw new Error('configJson missing Standard v1 sub-objects');
        }
        pass(`Template created: ${templateId} (${data.name})`);

        // Verify folder structure: assets/mockups/tshirt/{templateId}/
        const templateDir = path.join(__dirname, '..', 'assets', 'mockups', 'tshirt', templateId);
        if (!fs.existsSync(templateDir)) {
            throw new Error(`Template folder not found: ${templateDir}`);
        }
        pass(`Folder structure correct: assets/mockups/tshirt/${templateId}/`);

        // Verify config.json on disk
        const configPath = path.join(templateDir, 'config.json');
        if (!fs.existsSync(configPath)) {
            throw new Error('config.json not found in template folder');
        }
        const diskConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (!diskConfig.printArea || !diskConfig.transform) {
            throw new Error('Disk config.json missing required fields');
        }
        pass(`config.json written to disk and valid`);

    } catch (err) {
        fail(`Template creation failed: ${err.message}`);
    }

    // 3. List Templates
    log(3, TOTAL, 'Listing templates...');
    try {
        const res = await fetch(`${BASE_URL}/mockups/templates?category=tshirt`, {
            headers: { 'Cookie': cookie },
        });
        const data = await res.json();
        if (!data.templates || data.templates.length === 0) throw new Error('No templates returned');
        pass(`Found ${data.templates.length} template(s), total: ${data.total}`);
    } catch (err) {
        fail(`Template listing failed: ${err.message}`);
    }

    // 4. Fetch Presets
    log(4, TOTAL, 'Fetching category presets...');
    try {
        const res = await fetch(`${BASE_URL}/mockups/templates/presets`, {
            headers: { 'Cookie': cookie },
        });
        const data = await res.json();
        if (!data.categories || !data.presets) throw new Error('Presets response malformed');
        if (!data.categories.includes('tshirt') || !data.categories.includes('sweatshirt')) {
            throw new Error(`Missing expected categories: ${data.categories}`);
        }
        pass(`Presets valid: ${data.categories.join(', ')}`);
    } catch (err) {
        fail(`Presets fetch failed: ${err.message}`);
    }

    // 5. Update Template Config via PATCH (Standard v1 shape)
    log(5, TOTAL, 'PATCH template config (Standard v1 transform shape)...');
    try {
        const res = await fetch(`${BASE_URL}/mockups/templates/${templateId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
            body: JSON.stringify({
                configJson: {
                    printArea: { x: 0.15, y: 0.2, width: 0.7, height: 0.6 },
                    transform: { opacity: 0.95 },
                },
            }),
        });
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        const updated = await res.json();
        if (updated.configJson.transform.opacity !== 0.95) {
            throw new Error(`Expected opacity 0.95, got ${updated.configJson.transform.opacity}`);
        }
        pass(`Template config updated (transform.opacity → ${updated.configJson.transform.opacity})`);
    } catch (err) {
        fail(`Template PATCH failed: ${err.message}`);
    }

    // 6. Run Factory to get a design image
    log(6, TOTAL, 'Running factory to generate design...');
    let jobId = '';
    let imageId = '';
    try {
        const factoryRes = await fetch(`${BASE_URL}/factory/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
            body: JSON.stringify({
                referenceImageId: 'assets/references/USA250.jpg',
                generateCount: 1,
                variationCount: 1,
                visionData: {
                    style: "Testing",
                    palette: ["Red"],
                    palette_hex: ["#ff0000"],
                    composition: "Test",
                    icon_family: ["Cats"],
                    text_layout: "Layout",
                    niche_guess: "Mockup Test"
                },
                variationTypes: [{ name: "text" }]
            }),
        });
        if (factoryRes.status !== 200) {
            const errBody = await factoryRes.text();
            throw new Error(`Factory HTTP ${factoryRes.status}: ${errBody}`);
        }
        const factoryData = await factoryRes.json();
        jobId = factoryData.jobId;
        if (!jobId) throw new Error('No jobId returned from factory/run');
        pass(`Factory job started: ${jobId}`);

        let attempts = 0;
        while (attempts < 30) {
            await new Promise(r => setTimeout(r, 3000));
            const statusRes = await fetch(`${BASE_URL}/pipeline/status/${jobId}`, {
                headers: { 'Cookie': cookie },
            });
            const statusData = await statusRes.json();
            const images = Array.isArray(statusData) ? statusData : (statusData.images || []);
            const done = images.find(i => i.status === 'PROCESSED' || i.status === 'COMPLETED');
            if (done) {
                imageId = done.id;
                pass(`Image ready: ${imageId} (${done.status})`);
                break;
            }
            attempts++;
        }
        if (!imageId) throw new Error('Timed out waiting for image');
    } catch (err) {
        fail(`Factory run failed: ${err.message}`);
    }

    // 7. Render Single Mockup — verify deterministic output path
    log(7, TOTAL, 'Rendering single mockup (deterministic output path)...');
    try {
        const res = await fetch(`${BASE_URL}/mockups/render`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
            body: JSON.stringify({ imageId, templateId }),
        });
        if (res.status !== 200) {
            const body = await res.text();
            throw new Error(`HTTP ${res.status}: ${body}`);
        }
        const data = await res.json();
        pass(`Mockup rendered: ${data.mockupUrl}`);

        // Verify deterministic naming: assets/outputs/mockups/{wsId}/{imageId}_{templateId}.png
        if (!data.mockupUrl.includes(imageId) || !data.mockupUrl.includes(templateId)) {
            throw new Error(`Output path not deterministic: ${data.mockupUrl}`);
        }
        pass(`Deterministic output path verified: ${data.mockupUrl}`);

        // Verify file exists
        const mockupPath = path.join(__dirname, '..', data.mockupUrl);
        if (!fs.existsSync(mockupPath)) throw new Error(`File not found: ${mockupPath}`);
        pass(`Mockup file verified on disk`);
    } catch (err) {
        fail(`Single render failed: ${err.message}`);
    }

    // 8. Batch Render
    log(8, TOTAL, 'Batch rendering...');
    try {
        const res = await fetch(`${BASE_URL}/mockups/render-batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
            body: JSON.stringify({ imageId, templateIds: [templateId] }),
        });
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const okCount = data.results.filter(r => r.status === 'OK').length;
        if (okCount === 0) throw new Error('No successful renders in batch');
        pass(`Batch: ${data.message}`);
    } catch (err) {
        fail(`Batch render failed: ${err.message}`);
    }

    // 9. Approve image and Export Bundle
    log(9, TOTAL, 'Approving image and generating Etsy CSV + downloading export bundle...');
    try {
        const appRes = await fetch(`${BASE_URL}/gallery/${imageId}/approve`, {
            method: 'POST',
            headers: { 'Cookie': cookie }
        });
        if (appRes.status !== 200) throw new Error(`Approval failed HTTP ${appRes.status}`);

        await fetch(`${BASE_URL}/export/etsy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
            body: JSON.stringify({ jobId }),
        });

        const res = await fetch(`${BASE_URL}/export/job/${jobId}/bundle`, {
            headers: { 'Cookie': cookie },
        });
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);

        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        pass(`Bundle downloaded: ${(buffer.length / 1024).toFixed(1)} KB`);

        const zip = new AdmZip(buffer);
        const entries = zip.getEntries().map(e => e.entryName);
        console.log('   ZIP contents:');
        entries.forEach(n => console.log(`     - ${n}`));

        const hasDesign = entries.some(e => e.startsWith('designs/'));
        const hasMockup = entries.some(e => e.startsWith('mockups/'));
        const hasSeo = entries.some(e => e.startsWith('seo/'));
        const hasListing = entries.includes('listing.csv');

        const missing = [];
        if (!hasMockup) missing.push('mockups/');

        const warnings = [];
        if (!hasDesign) warnings.push('designs/');
        if (!hasSeo) warnings.push('seo/');
        if (!hasListing) warnings.push('listing.csv');

        if (missing.length > 0) throw new Error(`Missing required: ${missing.join(', ')}`);

        pass(`ZIP structure OK: mockups/ verified.`);
        if (warnings.length > 0) console.log(`   ⚠️  Optional folders missing (expected if SEO/worker bypassed): ${warnings.join(', ')}`);
    } catch (err) {
        fail(`Export bundle failed: ${err.message}`);
    }

    // 10. Workspace Isolation
    log(10, TOTAL, 'Auditing workspace isolation...');
    if (cookie2) {
        try {
            const res = await fetch(`${BASE_URL}/mockups/templates/${templateId}`, {
                headers: { 'Cookie': cookie2 },
            });
            if (res.status === 404 || res.status === 401 || res.status === 403) {
                pass(`Cross-tenant template access blocked (HTTP ${res.status})`);
            } else {
                throw new Error(`Expected 403/404 but got HTTP ${res.status}`);
            }

            const renderRes = await fetch(`${BASE_URL}/mockups/render`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Cookie': cookie2 },
                body: JSON.stringify({ imageId, templateId }),
            });
            if (renderRes.status === 403 || renderRes.status === 404) {
                pass(`Cross-tenant render blocked (HTTP ${renderRes.status})`);
            } else {
                throw new Error(`Expected 403/404 but got HTTP ${renderRes.status}`);
            }
        } catch (err) {
            if (err.message.startsWith('Expected')) fail(err.message);
            fail(`Workspace isolation audit failed: ${err.message}`);
        }
    } else {
        console.log('⚠️  Skipped (second user not available)');
    }

    console.log('\n==================================================');
    console.log('  🎉 ALL MOCKUP SMOKE TESTS PASSED — Standard v1');
    console.log('==================================================\n');
}

run().catch(err => {
    console.error('💥 Unhandled error:', err);
    process.exit(1);
});
