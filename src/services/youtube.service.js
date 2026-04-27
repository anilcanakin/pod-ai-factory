/**
 * youtube.service.js
 *
 * Bir YouTube kanal veya playlist URL'si verildiğinde
 * yt-dlp ile video metadata listesi çeker.
 *
 * Gereksinim: `pip install yt-dlp` (veya yt-dlp binary PATH'te)
 */

const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

function cookiesArgs() {
    const p = process.env.YOUTUBE_COOKIES_PATH;
    return (p && fs.existsSync(p)) ? ['--cookies', p] : [];
}

/**
 * Kanal/playlist'teki videoları çek.
 * @param {string} channelUrl  YouTube kanal/playlist/video URL'si
 * @param {number} maxResults  Maksimum video sayısı (default 50)
 * @returns {Promise<{ videos: ChannelVideo[]; channelName: string|null; totalCount: number }>}
 */
async function extractChannelVideos(channelUrl, maxResults = 200) {
    return new Promise((resolve, reject) => {
        const args = [
            ...cookiesArgs(),
            '--flat-playlist',
            '--dump-single-json',
            '--playlist-end', String(maxResults),
            '--no-warnings',
            '--quiet',
            channelUrl,
        ];

        let stdout = '';
        let stderr = '';

        const proc = spawn('yt-dlp', args, { timeout: 180_000 });

        proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
        proc.stderr.on('data', chunk => { stderr += chunk.toString(); });

        proc.on('error', err => {
            if (err.code === 'ENOENT') {
                reject(new Error(
                    'yt-dlp bulunamadı. Kurulum: pip install yt-dlp  (veya winget install yt-dlp)'
                ));
            } else {
                reject(err);
            }
        });

        proc.on('close', () => {
            const raw = stdout.trim();
            if (!raw) {
                return reject(new Error(
                    `yt-dlp çıktı üretmedi. stderr: ${stderr.slice(0, 400)}`
                ));
            }

            let data;
            try {
                data = JSON.parse(raw);
            } catch (e) {
                // Bazen yt-dlp birden fazla JSON satırı döndürür — son geçerliyi al
                const lines = raw.split('\n').filter(Boolean);
                try { data = JSON.parse(lines[lines.length - 1]); }
                catch { return reject(new Error(`JSON parse hatası: ${e.message}`)); }
            }

            // Tek video URL'si verilmişse entries olmaz, kendisi bir video'dur
            const entries = data.entries ?? [data];

            const videos = entries
                .filter(e => e && (e.id || e.url))
                .map(e => {
                    const id = e.id || '';
                    const rawDate = e.upload_date || '';      // YYYYMMDD
                    const uploadDate = rawDate.length === 8
                        ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
                        : null;
                    // Derive a stable videoId from URL when yt-dlp flat-playlist omits id
                    const resolvedId = id || (e.url?.includes('watch?v=')
                        ? e.url.split('watch?v=')[1].split('&')[0]
                        : e.url?.split('/').pop() || '');
                    return {
                        videoId:    resolvedId,
                        title:      e.title || '(başlıksız)',
                        url:        e.url?.startsWith('http')
                                        ? e.url
                                        : `https://www.youtube.com/watch?v=${resolvedId}`,
                        viewCount:  typeof e.view_count === 'number' ? e.view_count : null,
                        uploadDate,
                        duration:   typeof e.duration === 'number' ? e.duration : null,
                        thumbnail:  e.thumbnail
                                        || (resolvedId ? `https://img.youtube.com/vi/${resolvedId}/mqdefault.jpg` : ''),
                        channelName: e.uploader || e.channel || data.uploader || data.channel || null,
                    };
                });

            resolve({
                videos,
                channelName: data.uploader || data.channel || null,
                totalCount:  data.playlist_count || videos.length,
            });
        });
    });
}

// ─── VTT / SRT Parser ────────────────────────────────────────────────────────

/**
 * .vtt veya .srt altyazı dosyasını ham metne çevirir.
 * Timing satırları, sekans numaraları, HTML etiketleri ve VTT metadata'sı temizlenir.
 * Ardışık tekrar eden satırlar (VTT'nin karakteristiği) deduplicate edilir.
 */
function parseSubtitleFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const textLines = [];

    for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        if (t.startsWith('WEBVTT')) continue;
        if (/^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->/.test(t)) continue;   // timing
        if (/^\d+$/.test(t)) continue;                                 // SRT sequence
        if (/^(NOTE|Kind|Language|Position|Align|Region):/.test(t)) continue; // VTT meta
        const text = t
            .replace(/<[^>]+>/g, '')     // HTML/VTT tags
            .replace(/&amp;/g,  '&')
            .replace(/&lt;/g,   '<')
            .replace(/&gt;/g,   '>')
            .replace(/&nbsp;/g, ' ')
            .trim();
        if (text) textLines.push(text);
    }

    // VTT genellikle aynı satırı birden fazla kez yazar — deduplicate
    const deduped = [];
    for (const line of textLines) {
        if (deduped[deduped.length - 1] !== line) deduped.push(line);
    }

    return deduped.join(' ').replace(/\s+/g, ' ').trim();
}

// ─── Deep Scavenger Transcript Fetcher ───────────────────────────────────────

/**
 * Deep Scavenger: transcript çekme — iki kademeli fallback.
 *
 * Kademe 1: youtube-transcript kütüphanesi (TR → EN → any)
 * Kademe 2: yt-dlp --write-auto-subs → .vtt / .srt parse
 *
 * @param {string} videoId  11 haneli YouTube video ID
 * @param {string} url      Orijinal URL (log için)
 * @returns {Promise<{ transcript: string; source: 'api'|'yt-dlp-auto' }>}
 */
async function fetchTranscriptWithFallback(videoId, url) {
    // ── Kademe 1: youtube-transcript API ─────────────────────────────────────
    try {
        const { pathToFileURL } = require('url');
        const ytEsmPath = path.join(
            path.dirname(require.resolve('youtube-transcript/package.json')),
            'dist/youtube-transcript.esm.js'
        );
        const { YoutubeTranscript } = await import(pathToFileURL(ytEsmPath).href);

        let segments;
        try { segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'tr' }); } catch (_) {}
        if (!segments?.length) {
            try { segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' }); } catch (_) {}
        }
        if (!segments?.length) {
            try { segments = await YoutubeTranscript.fetchTranscript(videoId); } catch (_) {}
        }
        if (segments?.length) {
            const transcript = segments.map(s => s.text.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
            return { transcript, source: 'api' };
        }
    } catch (_) {}

    // ── Kademe 2: yt-dlp auto-subs ───────────────────────────────────────────
    console.log(`[DeepScavenger] API altyazı yok → yt-dlp auto-subs deneniyor: ${videoId}`);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `yt-sub-${videoId}-`));

    try {
        await new Promise((resolve, reject) => {
            const proc = spawn('yt-dlp', [
                ...cookiesArgs(),
                '--write-auto-subs',
                '--skip-download',
                '--sub-format', 'vtt',
                '--sub-langs',  'tr,en,en-US,en-GB',
                '--output',     path.join(tmpDir, '%(id)s.%(ext)s'),
                '--no-warnings',
                '--quiet',
                `https://www.youtube.com/watch?v=${videoId}`,
            ], { timeout: 60_000 });

            let stderr = '';
            proc.stderr.on('data', c => { stderr += c.toString(); });
            proc.on('error', reject);
            proc.on('close', code => {
                const files = fs.readdirSync(tmpDir);
                if (code !== 0 && files.length === 0) {
                    reject(new Error(`yt-dlp auto-subs hata (exit ${code}): ${stderr.slice(0, 200)}`));
                } else {
                    resolve();
                }
            });
        });

        const files = fs.readdirSync(tmpDir);
        const subFile = files.find(f => f.endsWith('.vtt') || f.endsWith('.srt'));
        if (!subFile) throw new Error('yt-dlp auto-subs: altyazı dosyası oluşturulmadı');

        const transcript = parseSubtitleFile(path.join(tmpDir, subFile));
        return { transcript, source: 'yt-dlp-auto' };
    } finally {
        try {
            fs.readdirSync(tmpDir).forEach(f => fs.unlinkSync(path.join(tmpDir, f)));
            fs.rmdirSync(tmpDir);
        } catch (_) {}
    }
}

module.exports = { extractChannelVideos, fetchTranscriptWithFallback, parseSubtitleFile };
