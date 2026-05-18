/**
 * ingest-pdf-local.js
 *
 * Yerel makinede çalıştırılır. Belirtilen klasördeki PDF dosyalarını
 * Brain'e (knowledge/upload) gönderir. Backend localhost:3001'de olmalı.
 *
 * Kullanım:
 *   node scripts/ingest-pdf-local.js "C:/Users/Anılcan/Desktop/ETSY"
 *   node scripts/ingest-pdf-local.js  (varsayılan: Desktop/ETSY)
 */

const fs   = require('fs');
const path = require('path');
const http = require('http');

const SOURCE_DIR = process.argv[2] || path.join(
    process.env.USERPROFILE || process.env.HOME,
    'Desktop', 'ETSY'
);
const API_HOST = 'localhost';
const API_PORT = 3001;

// Öncelik sırasına göre hedef PDF'ler (en üsttekiler ilk işlenir)
const PRIORITY_KEYWORDS = [
    'seo', 'algoritma', 'prompt', 'yapay_zeka', 'print_on_demand',
    'fiyatlandirma', 'dijital', 'yuppion', 'blueprint', 'rehber'
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function uploadFile(filePath, fileName) {
    return new Promise((resolve, reject) => {
        const fileData   = fs.readFileSync(filePath);
        const boundary   = '----FormBoundary' + Date.now().toString(16);
        const fieldName  = 'file';
        const mimeType   = 'application/pdf';

        const header = Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\n` +
            `Content-Type: ${mimeType}\r\n\r\n`
        );
        const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
        const body   = Buffer.concat([header, fileData, footer]);

        const req = http.request(
            {
                host: API_HOST, port: API_PORT,
                path: '/api/knowledge/upload',
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': body.length,
                },
            },
            res => {
                let raw = '';
                res.on('data', d => raw += d);
                res.on('end', () => {
                    try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
                    catch { resolve({ status: res.statusCode, body: raw }); }
                });
            }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function priorityScore(name) {
    const lower = name.toLowerCase();
    let score = 0;
    PRIORITY_KEYWORDS.forEach((kw, i) => {
        if (lower.includes(kw)) score += (PRIORITY_KEYWORDS.length - i);
    });
    return score;
}

async function main() {
    // Sağlık kontrolü
    try {
        await new Promise((res, rej) => {
            const r = http.get(`http://${API_HOST}:${API_PORT}/health`, resp => {
                resp.resume(); res();
            });
            r.on('error', rej);
            r.setTimeout(3000, () => { r.destroy(); rej(new Error('timeout')); });
        });
    } catch (e) {
        console.error(`✗ Backend localhost:${API_PORT} yanıt vermiyor. npm run dev çalışıyor mu?`);
        process.exit(1);
    }
    console.log(`✓ Backend bağlantısı OK\n`);

    if (!fs.existsSync(SOURCE_DIR)) {
        console.error(`✗ Kaynak klasör bulunamadı: ${SOURCE_DIR}`);
        process.exit(1);
    }

    const allFiles = fs.readdirSync(SOURCE_DIR);
    const pdfs = allFiles
        .filter(f => f.toLowerCase().endsWith('.pdf'))
        .sort((a, b) => priorityScore(b) - priorityScore(a));

    if (!pdfs.length) {
        console.log('ℹ  Klasörde PDF dosyası bulunamadı.');
        return;
    }

    console.log(`📚 ${pdfs.length} PDF bulundu → Brain'e yükleniyor...\n`);

    let ok = 0, fail = 0;
    for (const file of pdfs) {
        const filePath = path.join(SOURCE_DIR, file);
        const sizeMB   = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
        process.stdout.write(`  📄 ${file} (${sizeMB} MB)... `);

        try {
            const r = await uploadFile(filePath, file);
            if (r.status === 200 || r.status === 201 || r.status === 202) {
                console.log(`✓`);
                ok++;
            } else {
                console.log(`⚠ HTTP ${r.status} — ${JSON.stringify(r.body).slice(0, 80)}`);
                fail++;
            }
        } catch (e) {
            console.log(`✗ ${e.message}`);
            fail++;
        }
        // BullMQ kuyruğunu boğmamak için biraz bekle
        await sleep(1500);
    }

    console.log(`\n✅ Tamamlandı: ${ok} PDF kuyruğa alındı, ${fail} hata`);
    console.log('Brain sayfasından işlem durumunu kontrol et: http://localhost:3000/dashboard/brain');
}

main().catch(e => { console.error('✗ Script hatası:', e.message); process.exit(1); });
