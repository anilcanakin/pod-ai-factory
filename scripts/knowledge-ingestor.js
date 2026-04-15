/**
 * Otonom Multimodal Bilgi Yutucu (Knowledge Ingestor)
 * Bu script; PDF, Metin, Ses ve Videoları (Ses + Görüntü Analizi ile) tek bir zengin 
 * bağlamda birleştirir ve Supabase pgvector'e gömer.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const pdf = require('pdf-parse');
const { YoutubeTranscript } = require('youtube-transcript');
const ffmpeg = require('fluent-ffmpeg');

// ── Yapılandırma ──────────────────────────────────────────────
const RAW_DATA_DIR = path.join(__dirname, '../data/raw');
const TEMP_FRAME_DIR = path.join(__dirname, '../temp_frames');
const CHUNK_SIZE = 1000; // Karakter bazlı yaklaşık 

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

if (!fs.existsSync(TEMP_FRAME_DIR)) fs.mkdirSync(TEMP_FRAME_DIR);

/**
 * Ana İşlem Döngüsü
 */
async function main() {
    console.log('[Ingestor] Otonom veri yutma işlemi başlatıldı...');
    
    if (!fs.existsSync(RAW_DATA_DIR)) {
        console.error('[Error] data/raw dizini bulunamadı.');
        return;
    }

    const files = fs.readdirSync(RAW_DATA_DIR);
    
    for (const file of files) {
        const filePath = path.join(RAW_DATA_DIR, file);
        const ext = path.extname(file).toLowerCase();
        let content = '';
        let metadata = { filename: file, source: 'local_file' };

        try {
            console.log(`[Ingestor] İşleniyor: ${file}`);

            if (ext === '.txt') {
                content = fs.readFileSync(filePath, 'utf-8');
            } 
            else if (ext === '.pdf') {
                const dataBuffer = fs.readFileSync(filePath);
                const pdfData = await pdf(dataBuffer);
                content = pdfData.text;
            }
            else if (ext === '.mp3' || ext === '.wav') {
                content = await getAudioTranscript(filePath);
            }
            else if (ext === '.mp4' || ext === '.mov' || ext === '.avi') {
                content = await getMultimodalVideoContent(filePath);
            }
            else {
                console.warn(`[Ingestor] Desteklenmeyen dosya formatı: ${ext}`);
                continue;
            }

            if (content.trim()) {
                await processAndStore(content, metadata);
                console.log(`[Ingestor] ✓ Başarıyla kaydedildi: ${file}`);
            }

        } catch (err) {
            console.error(`[Ingestor] ✗ Hata (${file}):`, err.message);
        }
    }

    console.log('[Ingestor] Tüm işlemler tamamlandı.');
}

/**
 * Ses Dosyası için Whisper Transcript
 */
async function getAudioTranscript(filePath) {
    console.log(`[Whisper] Ses metne dönüştürülüyor...`);
    const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: "whisper-1",
    });
    return `[SES]: ${transcription.text}`;
}

/**
 * Multimodal Video Analizi (Whisper + Vision API)
 */
async function getMultimodalVideoContent(filePath) {
    console.log(`[Multimodal] Video analiz ediliyor (Görüntü + Ses)...`);

    // 1. Ses Çıkarma ve Whisper
    const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(filePath), // Ffmpeg ile sesi ayırmadan da whisper akışı deneyebilirsiniz ancak büyük dosyalarda ses ayırmak daha güvenlidir.
        model: "whisper-1",
    });

    // 2. Ekran Görüntüsü Alma (Her 20 saniyede bir)
    const framesMetadata = await extractFrames(filePath);
    let visionDescriptions = '';

    console.log(`[Vision] ${framesMetadata.length} kare analiz ediliyor...`);

    for (const frame of framesMetadata) {
        const description = await analyzeFrame(frame.path);
        visionDescriptions += `\n[EKRAN @ ${frame.timestamp}s]: ${description}`;
    }

    // 3. Birleştirme
    const finalContext = `
[SES AKTARIMI]:
${transcription.text}

[GÖRSEL ANALİZ VE EKRAN KAYITLARI]:
${visionDescriptions}
    `.trim();

    return finalContext;
}

/**
 * Videodan Kare Yakalama (ffmpeg)
 */
function extractFrames(videoPath) {
    return new Promise((resolve, reject) => {
        const frames = [];
        const filename = path.basename(videoPath, path.extname(videoPath));
        
        ffmpeg(videoPath)
            .screenshots({
                timestamps: ['20', '40', '60', '80', '100', '120'], // Basitlik için statik, dinamik de yapılabilir
                folder: TEMP_FRAME_DIR,
                filename: `${filename}-at-%s-sec.png`
            })
            .on('end', () => {
                const files = fs.readdirSync(TEMP_FRAME_DIR).filter(f => f.startsWith(filename));
                files.forEach(f => {
                    const ts = f.match(/at-(\d+)-sec/)?.[1] || '??';
                    frames.push({ path: path.join(TEMP_FRAME_DIR, f), timestamp: ts });
                });
                resolve(frames);
            })
            .on('error', (err) => reject(err));
    });
}

/**
 * GPT-4o Vision ile Kare Analizi
 */
async function analyzeFrame(imagePath) {
    const base64Image = fs.readFileSync(imagePath).toString('base64');

    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: "Bu eğitim videosu karesinde ne görünüyor? Varsa arayüzdeki yazıları, Etsy araçlarını, butonları ve anahtar verileri kısa ve net açıkla." },
                    {
                        type: "image_url",
                        image_url: { url: `data:image/png;base64,${base64Image}` }
                    },
                ],
            },
        ],
        max_tokens: 300,
    });

    return response.choices[0].message.content;
}

/**
 * Metni Chunk'lara böl, Embedding al ve Kaydet
 */
async function processAndStore(fullText, metadata) {
    // Basit Chunking (Geliştirilebilir: RecursiveCharacterTextSplitter)
    const chunks = [];
    for (let i = 0; i < fullText.length; i += CHUNK_SIZE) {
        chunks.push(fullText.substring(i, i + CHUNK_SIZE));
    }

    for (const chunk of chunks) {
        // Embedding Al
        const embeddingResponse = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: chunk,
        });
        const embedding = embeddingResponse.data[0].embedding;

        // Supabase'e Yaz
        const { error } = await supabase
            .from('etsy_knowledge')
            .insert({
                content: chunk,
                metadata: { ...metadata, chunk_preview: chunk.substring(0, 50) + '...' },
                embedding: embedding
            });

        if (error) console.error('[Supabase Error]', error.message);
    }
}

main().catch(console.error);
