/**
 * ingest-twitter-ssh.js
 *
 * SSH sunucusunda çalıştırılır. ~/pod-ai-factory/uploads/twitter/ dizinindeki
 * .txt dosyalarını Brain'e (add-text) gönderir. Her dosyayı bölüm bölüm işler.
 *
 * Önce txt dosyalarını SSH'a kopyala:
 *   scp "Yeni Metin Belgesi.txt" anilcan@pod-ai-hq:~/pod-ai-factory/uploads/twitter/etsy-threads.txt
 *
 * Sonra SSH'da çalıştır:
 *   cd ~/pod-ai-factory && node scripts/ingest-twitter-ssh.js
 */

const fs   = require('fs');
const path = require('path');
const http = require('http');

const TWITTER_DIR = path.join(__dirname, '../uploads/twitter');
const API_HOST    = 'localhost';
const API_PORT    = 3001;
// Her bölüm arası ayırıcı — büyük dosyaları anlamlı chunk'lara böler
const SECTION_SEP = /\n[-─]{10,}\n|\n\n\n+/;
const MAX_CHUNK   = 8000; // karakter

function postJson(path, data) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const req  = http.request(
            { host: API_HOST, port: API_PORT, path, method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Dosyayı anlamlı chunk'lara böl
function splitIntoChunks(content) {
    const sections = content.split(SECTION_SEP).map(s => s.trim()).filter(s => s.length > 20);
    const chunks = [];
    let current  = '';

    for (const section of sections) {
        if ((current + section).length > MAX_CHUNK && current.length > 0) {
            chunks.push(current.trim());
            current = section;
        } else {
            current += (current ? '\n\n' : '') + section;
        }
    }
    if (current.trim().length > 20) chunks.push(current.trim());
    return chunks;
}

async function main() {
    // Sağlık kontrolü
    try {
        await postJson('/health', {});
    } catch (e) {
        console.error('✗ Backend localhost:3001 yanıt vermiyor:', e.message);
        process.exit(1);
    }
    console.log('✓ Backend bağlantısı OK\n');

    if (!fs.existsSync(TWITTER_DIR)) {
        fs.mkdirSync(TWITTER_DIR, { recursive: true });
        console.log(`ℹ  ${TWITTER_DIR} oluşturuldu. .txt dosyalarını buraya kopyala ve tekrar çalıştır.`);
        return;
    }

    const files = fs.readdirSync(TWITTER_DIR).filter(f => f.endsWith('.txt'));
    if (!files.length) {
        console.log('ℹ  uploads/twitter/ klasörü boş. .txt dosyalarını ekle ve tekrar çalıştır.');
        return;
    }

    let totalOk = 0, totalFail = 0;

    for (const file of files) {
        const filePath = path.join(TWITTER_DIR, file);
        const content  = fs.readFileSync(filePath, 'utf8');
        const chunks   = splitIntoChunks(content);
        const baseName = path.basename(file, '.txt');

        console.log(`📄 ${file} → ${chunks.length} bölüm`);

        for (let i = 0; i < chunks.length; i++) {
            const title = `Twitter/${baseName} [${i + 1}/${chunks.length}]`;
            try {
                const r = await postJson('/api/brain/add-text', {
                    title,
                    content:  chunks[i],
                    source:   'twitter',
                    category: 'STRATEGY',
                });
                if (r.status === 200 || r.status === 201) {
                    console.log(`  ✓ Bölüm ${i + 1} — ${chunks[i].length} karakter`);
                    totalOk++;
                } else {
                    const errMsg = typeof r.body === 'object' ? (r.body.error || JSON.stringify(r.body)) : String(r.body).slice(0, 200);
                    console.log(`  ⚠ Bölüm ${i + 1} — HTTP ${r.status}: ${errMsg}`);
                    totalFail++;
                }
            } catch (e) {
                console.log(`  ✗ Bölüm ${i + 1} — ${e.message}`);
                totalFail++;
            }
            await sleep(600);
        }
    }

    console.log(`\n✅ Tamamlandı: ${totalOk} bölüm kaydedildi, ${totalFail} hata`);
    console.log('Brain sayfasından kontrol et: http://localhost:3000/dashboard/brain');
}

main().catch(e => { console.error('✗ Script hatası:', e.message); process.exit(1); });
