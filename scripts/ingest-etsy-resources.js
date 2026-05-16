/**
 * ingest-etsy-resources.js
 *
 * C:\Users\Anılcan\Desktop\ETSY klasöründeki tüm kaynakları Brain'e yükler.
 *
 * Kullanım:
 *   node scripts/ingest-etsy-resources.js
 *
 * Gereksinim: backend localhost:3001'de çalışıyor olmalı.
 */

const fs       = require('fs');
const path     = require('path');
const FormData = require('form-data');
const axios    = require('axios');

const API_BASE   = 'http://localhost:3001';
const ETSY_DIR   = 'C:/Users/Anılcan/Desktop/ETSY';
const BATCH_SIZE = 50; // bulk-expert/social max 50

// ─── Renk + sembol logları ─────────────────────────────────────────────────────
const log = {
    info:  (msg) => console.log(`  ℹ  ${msg}`),
    ok:    (msg) => console.log(`  ✓  ${msg}`),
    warn:  (msg) => console.log(`  ⚠  ${msg}`),
    err:   (msg) => console.log(`  ✗  ${msg}`),
    head:  (msg) => console.log(`\n${'─'.repeat(60)}\n  ${msg}\n${'─'.repeat(60)}`),
};

// ─── HTTP yardımcıları ─────────────────────────────────────────────────────────

async function postForm(url, form) {
    try {
        const res = await axios.post(url, form, {
            headers: form.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 120_000,
        });
        return { ok: true, status: res.status, body: res.data };
    } catch (e) {
        const status = e.response?.status ?? 0;
        const body   = e.response?.data ?? e.message;
        return { ok: false, status, body };
    }
}

async function postJson(url, data) {
    try {
        const res = await axios.post(url, data, { timeout: 30_000 });
        return { ok: true, status: res.status, body: res.data };
    } catch (e) {
        const status = e.response?.status ?? 0;
        const body   = e.response?.data ?? e.message;
        return { ok: false, status, body };
    }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── 1. PDF / Video yükleme ────────────────────────────────────────────────────

async function uploadKnowledgeFile(filePath) {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), {
        filename: path.basename(filePath),
        contentType: filePath.endsWith('.mp4') ? 'video/mp4' : 'application/pdf',
    });

    const result = await postForm(`${API_BASE}/api/knowledge/upload`, form);
    return result;
}

// ─── 2. Görsel batch yükleme (50'li) ──────────────────────────────────────────
// esrabayramco → bulk-expert (uzman içgörüsü)
// 250          → bulk-social (sosyal medya / trend sinyali)

async function uploadImageBatch(imagePaths, endpoint) {
    const form = new FormData();
    for (const imgPath of imagePaths) {
        const ext  = path.extname(imgPath).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
        form.append('images', fs.createReadStream(imgPath), {
            filename: path.basename(imgPath),
            contentType: mime,
        });
    }

    const result = await postForm(`${API_BASE}/api/brain/${endpoint}`, form);
    return result;
}

// ─── 3. Twitter / txt metin yükleme ───────────────────────────────────────────

async function addTextToBrain(title, content) {
    const result = await postJson(`${API_BASE}/api/brain/add-text`, {
        title,
        content,
        source: 'twitter',
        category: 'STRATEGY',
    });
    return result;
}

// ─── Ana fonksiyon ─────────────────────────────────────────────────────────────

async function main() {
    console.log('\n🚀 ETSY Kaynak Yükleme Başlıyor...\n');

    // ── Sağlık kontrolü ────────────────────────────────────────────────────────
    try {
        const health = await axios.get(`${API_BASE}/health`);
        if (health.status !== 200) throw new Error('Backend yanıt vermiyor');
        log.ok('Backend bağlantısı OK');
    } catch (e) {
        log.err(`Backend'e bağlanılamadı: ${e.message}`);
        log.err('Lütfen "npm run dev:backend" ile backend\'i başlat.');
        process.exit(1);
    }

    // ── PDF'ler ────────────────────────────────────────────────────────────────
    const pdfs = fs.readdirSync(ETSY_DIR)
        .filter(f => f.toLowerCase().endsWith('.pdf'))
        .map(f => path.join(ETSY_DIR, f));

    log.head(`📚 ${pdfs.length} PDF yükleniyor`);
    let pdfOk = 0, pdfFail = 0;

    for (const pdfPath of pdfs) {
        const name = path.basename(pdfPath);
        try {
            const r = await uploadKnowledgeFile(pdfPath);
            if (r.ok) {
                log.ok(`${name}`);
                pdfOk++;
            } else {
                log.warn(`${name} — ${r.status}: ${JSON.stringify(r.body).slice(0, 80)}`);
                pdfFail++;
            }
        } catch (e) {
            log.err(`${name} — ${e.message}`);
            pdfFail++;
        }
        await sleep(800); // BullMQ'ya nefes aldır
    }
    console.log(`\n  PDF Sonuç: ${pdfOk} başarılı, ${pdfFail} hata`);

    // ── MP4'ler ────────────────────────────────────────────────────────────────
    const videos = fs.readdirSync(ETSY_DIR)
        .filter(f => f.toLowerCase().endsWith('.mp4'))
        .map(f => path.join(ETSY_DIR, f));

    if (videos.length > 0) {
        log.head(`🎥 ${videos.length} video yükleniyor`);
        for (const vidPath of videos) {
            const name = path.basename(vidPath);
            try {
                const r = await uploadKnowledgeFile(vidPath);
                if (r.ok) log.ok(`${name}`);
                else log.warn(`${name} — ${r.status}`);
            } catch (e) {
                log.err(`${name} — ${e.message}`);
            }
            await sleep(1000);
        }
    }

    // ── esrabayramco görselleri (bulk-expert, 50'li batch) ─────────────────────
    const esraDir = path.join(ETSY_DIR, 'esrabayramco');
    if (fs.existsSync(esraDir)) {
        const images = fs.readdirSync(esraDir)
            .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
            .map(f => path.join(esraDir, f));

        log.head(`🖼️  esrabayramco — ${images.length} görsel (bulk-expert, ${BATCH_SIZE}'li batch)`);
        let imgOk = 0, imgFail = 0;

        for (let i = 0; i < images.length; i += BATCH_SIZE) {
            const batch     = images.slice(i, i + BATCH_SIZE);
            const batchNum  = Math.floor(i / BATCH_SIZE) + 1;
            const batchTotal = Math.ceil(images.length / BATCH_SIZE);
            log.info(`Batch ${batchNum}/${batchTotal} (${batch.length} görsel) gönderiliyor...`);

            try {
                const r = await uploadImageBatch(batch, 'bulk-expert');
                if (r.ok) {
                    log.ok(`Batch ${batchNum} kuyruğa alındı — ${r.body?.queued ?? batch.length} iş`);
                    imgOk += batch.length;
                } else {
                    log.warn(`Batch ${batchNum} — ${r.status}: ${JSON.stringify(r.body).slice(0, 100)}`);
                    imgFail += batch.length;
                }
            } catch (e) {
                log.err(`Batch ${batchNum} — ${e.message}`);
                imgFail += batch.length;
            }
            await sleep(1500);
        }
        console.log(`\n  esrabayramco Sonuç: ${imgOk} kuyruğa alındı, ${imgFail} hata`);
    }

    // ── 250 klasörü görselleri (bulk-social) ───────────────────────────────────
    const dir250 = path.join(ETSY_DIR, '250');
    if (fs.existsSync(dir250)) {
        const images = fs.readdirSync(dir250)
            .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
            .map(f => path.join(dir250, f));

        log.head(`🖼️  250 klasörü — ${images.length} görsel (bulk-social, ${BATCH_SIZE}'li batch)`);
        let imgOk = 0, imgFail = 0;

        for (let i = 0; i < images.length; i += BATCH_SIZE) {
            const batch    = images.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const batchTotal = Math.ceil(images.length / BATCH_SIZE);
            log.info(`Batch ${batchNum}/${batchTotal} (${batch.length} görsel) gönderiliyor...`);

            try {
                const r = await uploadImageBatch(batch, 'bulk-social');
                if (r.ok) {
                    log.ok(`Batch ${batchNum} kuyruğa alındı — ${r.body?.queued ?? batch.length} iş`);
                    imgOk += batch.length;
                } else {
                    log.warn(`Batch ${batchNum} — ${r.status}: ${JSON.stringify(r.body).slice(0, 100)}`);
                    imgFail += batch.length;
                }
            } catch (e) {
                log.err(`Batch ${batchNum} — ${e.message}`);
                imgFail += batch.length;
            }
            await sleep(1500);
        }
        console.log(`\n  250 Sonuç: ${imgOk} kuyruğa alındı, ${imgFail} hata`);
    }

    // ── Twitter txt (varsa) ────────────────────────────────────────────────────
    const twitterDir = path.join(ETSY_DIR, 'twitter');
    if (fs.existsSync(twitterDir)) {
        const txts = fs.readdirSync(twitterDir)
            .filter(f => f.toLowerCase().endsWith('.txt'))
            .map(f => path.join(twitterDir, f));

        if (txts.length > 0) {
            log.head(`🐦 ${txts.length} Twitter txt dosyası ekleniyor`);
            for (const txtPath of txts) {
                const name    = path.basename(txtPath, '.txt');
                const content = fs.readFileSync(txtPath, 'utf8');
                if (content.trim().length < 10) { log.warn(`${name} — boş, atlanıyor`); continue; }
                try {
                    const r = await addTextToBrain(`Twitter: ${name}`, content);
                    if (r.ok) log.ok(`${name} (${content.length} karakter)`);
                    else log.warn(`${name} — ${r.status}`);
                } catch (e) {
                    log.err(`${name} — ${e.message}`);
                }
                await sleep(500);
            }
        }
    } else {
        log.info('Twitter klasörü bulunamadı (ETSY/twitter/) — hazır olduğunda ekle ve tekrar çalıştır.');
    }

    // ── Özet ───────────────────────────────────────────────────────────────────
    log.head('✅ Yükleme Tamamlandı');
    console.log(`  PDF'ler ve videolar: BullMQ kuyruğunda işleniyor (arka planda)`);
    console.log(`  Görseller: BullMQ kuyruğunda Claude Vision ile analiz ediliyor`);
    console.log(`  Brain sayfasından ilerlemeyi takip edebilirsin:`);
    console.log(`  → http://localhost:3000/dashboard/brain\n`);
    console.log(`  Twitter postları hazır olunca:`);
    console.log(`  ETSY/twitter/ klasörü oluştur, .txt dosyalarını içine koy, scripti tekrar çalıştır.\n`);
}

main().catch(err => {
    log.err(`Script çöktü: ${err.message}`);
    process.exit(1);
});
