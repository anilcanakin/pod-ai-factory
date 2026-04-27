#!/usr/bin/env node
/**
 * Bulk Knowledge Ingest — YouTube Transcript → Academy Brain
 *
 * Kullanım:
 *   node src/scripts/bulk-ingest.js
 *   node src/scripts/bulk-ingest.js --dry-run          # transcript'i çek, kaydetme
 *   node src/scripts/bulk-ingest.js --url <URL>        # tek video
 *   node src/scripts/bulk-ingest.js --category RULES   # tüm videolara kategori override
 *   node src/scripts/bulk-ingest.js --reset            # processed.json'u sıfırla
 *
 * Giriş  : data/urls.json
 * Çıkış  : data/processed.json  (işlenen videoların kaydı)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs         = require('fs');
const path       = require('path');
const { YoutubeTranscript } = require('youtube-transcript');
const anthropic  = require('../lib/anthropic');
const { ingestText } = require('../services/knowledge.service');

// ─── Paths ────────────────────────────────────────────────────────────────────

const DATA_DIR        = path.join(__dirname, '../../data');
const URLS_FILE       = path.join(DATA_DIR, 'urls.json');
const PROCESSED_FILE  = path.join(DATA_DIR, 'processed.json');

const WORKSPACE_ID    = process.env.DEFAULT_WORKSPACE_ID || 'default-workspace';
const VALID_CATEGORIES = ['STRATEGY', 'RULES', 'SEO_TACTICS', 'SEO', 'VISUAL', 'MANAGEMENT'];

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2);
const isDryRun    = args.includes('--dry-run');
const isReset     = args.includes('--reset');
const singleUrl   = args.includes('--url')      ? args[args.indexOf('--url') + 1]      : null;
const catOverride = args.includes('--category') ? args[args.indexOf('--category') + 1] : null;

if (catOverride && !VALID_CATEGORIES.includes(catOverride)) {
    console.error(`[Bulk Ingest] Geçersiz kategori: ${catOverride}. Geçerli: ${VALID_CATEGORIES.join(', ')}`);
    process.exit(1);
}

// ─── Processed tracker ────────────────────────────────────────────────────────

function loadProcessed() {
    try {
        if (fs.existsSync(PROCESSED_FILE)) {
            return JSON.parse(fs.readFileSync(PROCESSED_FILE, 'utf8'));
        }
    } catch { /* ignore */ }
    return { processed: [], errors: [] };
}

function saveProcessed(state) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PROCESSED_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function extractVideoId(url) {
    const patterns = [
        /[?&]v=([^&#]+)/,
        /youtu\.be\/([^?#]+)/,
        /youtube\.com\/embed\/([^?#]+)/,
        /youtube\.com\/shorts\/([^?#]+)/,
    ];
    for (const re of patterns) {
        const m = url.match(re);
        if (m) return m[1];
    }
    return null;
}

// ─── YouTube Transcript ───────────────────────────────────────────────────────

async function fetchTranscript(url) {
    const videoId = extractVideoId(url);
    if (!videoId) throw new Error(`Video ID çıkarılamadı: ${url}`);

    console.log(`  [Transcript] Çekiliyor: ${videoId}`);

    const segments = await YoutubeTranscript.fetchTranscript(videoId, {
        lang: 'tr',
    }).catch(async () => {
        // Türkçe yoksa İngilizce dene
        return YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
    }).catch(async () => {
        // Auto-generated transcript dene (dil kodu olmadan)
        return YoutubeTranscript.fetchTranscript(videoId);
    });

    if (!segments || segments.length === 0) throw new Error('Transcript boş veya bulunamadı');

    const text = segments
        .map(s => s.text.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

    console.log(`  [Transcript] ${segments.length} segment, ${text.length} karakter`);
    return { text, videoId, segmentCount: segments.length };
}

// ─── Claude Haiku — Knowledge Extraction ─────────────────────────────────────

async function extractKnowledge(transcript, title, category) {
    const catHint = category === 'SEO_TACTICS'
        ? 'SEO taktikleri, keyword stratejileri, başlık/etiket formülleri'
        : category === 'RULES'
        ? 'yasaklar, dikkat edilmesi gerekenler, kesinlikle yapılmaması gerekenler'
        : 'iş stratejileri, büyüme taktikleri, niche seçimi, fiyatlandırma, üretim kararları';

    const prompt = `Aşağıdaki YouTube video transcript'ini analiz et. Video başlığı: "${title}"

Özellikle şunları çıkar (kategori: ${catHint}):

TRANSCRIPT:
${transcript.slice(0, 12000)}

Görev: Bu metindeki Etsy POD iş bilgilerini, stratejileri, yasakları ve SEO taktiklerini madde madde çıkar.
Yalnızca somut, uygulanabilir bilgiler yaz. Genel laflar ve tanıtım cümlelerini atla.

Çıktıyı şu formatta ver:

## Temel Stratejiler
- [madde]
- [madde]

## SEO & Keyword Taktikleri
- [madde]
- [madde]

## Dikkat Edilmesi Gerekenler / Yasaklar
- [madde]
- [madde]

## Niche & Ürün Kararları
- [madde]
- [madde]

## Ek İpuçları
- [madde]

Eğer transcript bu kategorilerden ilgisiz birini içermiyorsa o bölümü atla.
Türkçe yaz. Her madde maksimum 2 cümle.`;

    const res = await anthropic.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages:   [{ role: 'user', content: prompt }],
    });

    const extracted = res.content[0].text.trim();
    console.log(`  [Claude] ${extracted.length} karakter bilgi çıkarıldı`);
    return extracted;
}

// ─── Process single entry ─────────────────────────────────────────────────────

async function processEntry(entry, processedState) {
    const url      = typeof entry === 'string' ? entry : entry.url;
    const title    = entry.title || url;
    const category = catOverride || entry.category || 'STRATEGY';
    const videoId  = extractVideoId(url);

    if (!videoId) {
        console.warn(`  [Skip] Geçersiz URL: ${url}`);
        return false;
    }

    // Daha önce işlendi mi?
    if (processedState.processed.some(p => p.videoId === videoId)) {
        console.log(`  [Skip] Zaten işlendi: ${videoId}`);
        return false;
    }

    console.log(`\n▶ İşleniyor: "${title}"`);
    console.log(`  URL: ${url}`);
    console.log(`  Kategori: ${category}`);

    try {
        // 1. Transcript çek
        const { text, segmentCount } = await fetchTranscript(url);

        // 2. Claude ile bilgi çıkar
        const knowledge = await extractKnowledge(text, title, category);

        if (!knowledge.trim()) {
            throw new Error('Claude boş çıktı döndürdü');
        }

        // 3. Kaydet (dry-run değilse)
        if (!isDryRun) {
            const saved = await ingestText(WORKSPACE_ID, `[YouTube] ${title}`, knowledge, category);
            console.log(`  [Kaydedildi] ${saved.length} chunk → DB`);
        } else {
            console.log('  [Dry-run] Kayıt atlandı.');
            console.log('  [Preview]\n' + knowledge.slice(0, 400) + '...');
        }

        // 4. Processed'e ekle
        processedState.processed.push({
            videoId,
            url,
            title,
            category,
            segmentCount,
            processedAt: new Date().toISOString(),
        });

        return true;

    } catch (err) {
        console.error(`  [Hata] ${err.message}`);
        processedState.errors.push({
            videoId,
            url,
            title,
            error:   err.message,
            failedAt: new Date().toISOString(),
        });
        return false;
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║    POD AI Factory — Bulk Knowledge Ingest ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log(`Workspace: ${WORKSPACE_ID}`);
    if (isDryRun)    console.log('⚠  DRY-RUN modu — DB kaydı yapılmayacak');
    if (catOverride) console.log(`ℹ  Kategori override: ${catOverride}`);
    console.log('');

    // Reset
    if (isReset) {
        saveProcessed({ processed: [], errors: [] });
        console.log('✓ processed.json sıfırlandı.');
    }

    const processedState = loadProcessed();

    // URL listesini belirle
    let entries = [];

    if (singleUrl) {
        entries = [{ url: singleUrl, title: singleUrl, category: catOverride || 'STRATEGY' }];
    } else {
        if (!fs.existsSync(URLS_FILE)) {
            console.error(`[Hata] ${URLS_FILE} bulunamadı. Önce data/urls.json dosyasını oluştur.`);
            process.exit(1);
        }
        const raw = JSON.parse(fs.readFileSync(URLS_FILE, 'utf8'));
        entries = Array.isArray(raw) ? raw : [raw];
    }

    console.log(`Toplam: ${entries.length} video`);
    console.log(`Daha önce işlenen: ${processedState.processed.length}`);
    console.log('');

    let successCount = 0;
    let skipCount    = 0;
    let errorCount   = 0;

    for (const entry of entries) {
        const result = await processEntry(entry, processedState);
        if (result === true)  successCount++;
        else if (result === false && processedState.processed.some(
            p => p.videoId === extractVideoId(typeof entry === 'string' ? entry : entry.url)
        )) skipCount++;
        else errorCount++;

        // Her video sonrası processed.json'u güncelle (crash durumunda veri kaybı olmaz)
        if (!isDryRun) saveProcessed(processedState);

        // Rate-limit: Claude API'sine aşırı istek gönderme
        await new Promise(r => setTimeout(r, 1500));
    }

    console.log('');
    console.log('══════════════════════════════════════════');
    console.log(`✓ Başarılı : ${successCount}`);
    console.log(`⏭ Atlanan  : ${processedState.processed.length - (processedState.processed.length - successCount)}`);
    console.log(`✗ Hata     : ${processedState.errors.length}`);
    console.log('══════════════════════════════════════════');

    if (processedState.errors.length > 0) {
        console.log('\nHatalı videolar:');
        processedState.errors.forEach(e => {
            console.log(`  • ${e.title || e.url}: ${e.error}`);
        });
    }

    console.log('\nTamamlandı. Bilgiler Academy Brain\'e kaydedildi.');
    process.exit(0);
}

main().catch(err => {
    console.error('\n[Fatal]', err.message);
    process.exit(1);
});
