/**
 * process-brain-images.js
 *
 * assets/uploads/brain/ klasöründeki görselleri direkt brain service ile işler.
 * BullMQ kuyruğunu bypass eder.
 *
 * Kullanım: node scripts/process-brain-images.js
 */

const fs   = require('fs');
const path = require('path');

const BRAIN_DIR    = path.join(__dirname, '../assets/uploads/brain');
const WORKSPACE_ID = 'default-workspace';
const DELAY_MS     = 2000; // Claude rate limit için

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = {
    ok:   (msg) => console.log(`  ✓  ${msg}`),
    warn: (msg) => console.log(`  ⚠  ${msg}`),
    head: (msg) => console.log(`\n${'─'.repeat(60)}\n  ${msg}\n${'─'.repeat(60)}`),
};

async function main() {
    console.log('\n🧠 Brain Görsel İşleme Başlıyor...\n');

    const brain = require('../src/services/brain.service');

    const files = fs.readdirSync(BRAIN_DIR)
        .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
        .sort()
        .map(f => path.join(BRAIN_DIR, f));

    log.head(`${files.length} görsel işlenecek (2 sn aralıklı)`);

    let ok = 0, fail = 0;

    for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        const name     = path.basename(filePath);

        // esrabayramco (expert) vs 250 (social) ayrımı:
        // esrabayramco görselleri jpg, 250 klasörü görselleri png
        const ext    = path.extname(filePath).toLowerCase();
        const isJpg  = ext === '.jpg' || ext === '.jpeg';
        const title  = isJpg ? `Expert Strategy: ${name}` : `Social Trend: ${name}`;

        try {
            let memory;
            if (isJpg) {
                memory = await brain.ingestExpertInsight(WORKSPACE_ID, filePath, title);
            } else {
                memory = await brain.ingestSocialProof(WORKSPACE_ID, filePath, title);
            }
            log.ok(`[${i + 1}/${files.length}] ${name} → ${memory.id.slice(0, 8)}`);
            ok++;
        } catch (err) {
            log.warn(`[${i + 1}/${files.length}] ${name} → ${err.message.slice(0, 100)}`);
            fail++;
        }

        if (i < files.length - 1) await sleep(DELAY_MS);
    }

    log.head('✅ Tamamlandı');
    console.log(`  Başarılı: ${ok} | Hatalı: ${fail}\n`);
}

main().catch(err => {
    console.error('Script çöktü:', err.message);
    process.exit(1);
});
