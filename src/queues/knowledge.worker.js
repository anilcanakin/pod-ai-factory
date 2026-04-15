const { Worker } = require('bullmq');
const redisConnection = require('../config/redis');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const ffmpeg = require('fluent-ffmpeg');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const TEMP_FRAME_DIR = path.join(__dirname, '../../temp_frames');
if (!fs.existsSync(TEMP_FRAME_DIR)) fs.mkdirSync(TEMP_FRAME_DIR, { recursive: true });

const CHUNK_SIZE = 1000;

async function processKnowledge(job) {
    const { type, filePath, url, originalName } = job.data;
    console.log(`[KnowledgeWorker] İşlenen tip: ${type} | JobID: ${job.id}`);

    let content = '';
    let metadata = { job_id: job.id, source_type: type };

    try {
        if (type === 'FILE') {
            const ext = path.extname(filePath).toLowerCase();
            metadata.filename = originalName;

            if (ext === '.pdf') {
                const dataBuffer = fs.readFileSync(filePath);
                const pdf = require('pdf-parse');
                const pdfData = await pdf(dataBuffer);
                content = pdfData.text;
            } else if (['.mp4', '.mov', '.avi', '.mp3', '.wav'].includes(ext)) {
                content = await getMultimodalContent(filePath);
            } else if (ext === '.txt') {
                content = fs.readFileSync(filePath, 'utf-8');
            }
        } else if (type === 'YOUTUBE') {
            const { YoutubeTranscript } = require('youtube-transcript');
            const transcripts = await YoutubeTranscript.fetchTranscript(url);
            content = transcripts.map(t => t.text).join(' ');
            metadata.url = url;
            metadata.filename = 'YouTube Video';
        }

        if (content.trim()) {
            await chunkAndEmbed(content, metadata);
            console.log(`[KnowledgeWorker] ✓ Başarıyla işlendi: ${originalName || url}`);
        }

        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);

    } catch (err) {
        console.error(`[KnowledgeWorker] ✗ Hata: ${err.message}`);
        throw err;
    }
}

/**
 * Multimodal İşleme (Compressed Whisper + Vision)
 */
async function getMultimodalContent(filePath) {
    console.log(`[Multimodal] Video/Ses analiz ediliyor: ${path.basename(filePath)}`);
    const ext = path.extname(filePath).toLowerCase();
    const isVideo = ['.mp4', '.mov', '.avi'].includes(ext);
    
    const compressedAudioPath = path.join(TEMP_FRAME_DIR, `audio_${Date.now()}.mp3`);
    console.log('[Multimodal] Ses sıkıştırılıyor...');
    
    await new Promise((resolve, reject) => {
        ffmpeg(filePath)
            .noVideo()
            .audioCodec('libmp3lame')
            .audioBitrate('32k') 
            .audioChannels(1)    
            .save(compressedAudioPath)
            .on('end', resolve)
            .on('error', reject);
    });

    try {
        console.log('[Multimodal] Whisper transkripsiyon başlatıldı...');
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(compressedAudioPath),
            model: "whisper-1",
        });

        let finalContent = `[SES AKTARIMI]: ${transcription.text}`;

        if (isVideo) {
            console.log('[Multimodal] Video kareleri yakalanıyor...');
            const frames = await extractFrames(filePath);
            
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const promptParts = ["Aşağıdaki video karelerini analiz et. Stratejik tasarım elementlerini, metinleri ve niş fikirlerini topluca açıkla:"];
            
            frames.forEach(frame => {
                const frameBase64 = fs.readFileSync(frame.path).toString('base64');
                promptParts.push({ inlineData: { data: frameBase64, mimeType: "image/jpeg" } });
            });

            console.log(`[Multimodal] ${frames.length} kare tek seferde Gemini'ye gönderiliyor (Batching)...`);
            
            // ─── LOCAL RETRY (EXPONENTIAL BACKOFF) ───
            const callGeminiWithRetry = async (parts, attempts = 3) => {
                const delays = [2000, 5000, 10000];
                for (let i = 0; i < attempts; i++) {
                    try {
                        // Throttling: Her istek öncesi en az 2sn bekle (15-30 RPM hedefi)
                        await new Promise(r => setTimeout(r, 2000));
                        return await model.generateContent(parts);
                    } catch (err) {
                        if (err.message?.includes('429') && i < attempts - 1) {
                            console.warn(`[Gemini 429] Limit aşıldı, ${delays[i]/1000}sn sonra tekrar deneniyor (Deneme ${i+1}/${attempts})...`);
                            await new Promise(r => setTimeout(r, delays[i]));
                        } else throw err;
                    }
                }
            };

            const result = await callGeminiWithRetry(promptParts);
            
            const visionData = `\n\n[GÖRSEL ANALİZ - TOPLU]:\n${result.response.text()}`;
            finalContent += visionData;

            // Temizlik
            frames.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
        }

        return finalContent;
    } finally {
        if (fs.existsSync(compressedAudioPath)) fs.unlinkSync(compressedAudioPath);
    }
}

function extractFrames(videoPath) {
    return new Promise((resolve, reject) => {
        const frames = [];
        const baseName = Date.now();
        ffmpeg(videoPath)
            .screenshots({
                timestamps: ['10%', '30%', '50%', '70%', '90%'],
                folder: TEMP_FRAME_DIR,
                filename: `frame-${baseName}-%s.png`
            })
            .on('end', () => {
                const files = fs.readdirSync(TEMP_FRAME_DIR).filter(f => f.includes(`frame-${baseName}`));
                files.forEach(f => {
                    frames.push({ path: path.join(TEMP_FRAME_DIR, f), timestamp: 'N/A' });
                });
                resolve(frames);
            })
            .on('error', reject);
    });
}

async function chunkAndEmbed(fullText, metadata) {
    console.log(`[Brain] Embedding işlemi başlıyor. Toplam karakter: ${fullText.length}`);
    for (let i = 0; i < fullText.length; i += CHUNK_SIZE) {
        const chunk = fullText.substring(i, i + CHUNK_SIZE);
        try {
            const embed = await openai.embeddings.create({
                model: "text-embedding-3-small",
                input: chunk
            });
            await supabase.from('etsy_knowledge').insert({
                content: chunk,
                metadata: { ...metadata, preview: chunk.substring(0, 100) },
                embedding: embed.data[0].embedding
            });
        } catch (err) {
            console.error(`[Brain] Chunk embedding hatası (@${i}):`, err.message);
        }
    }
}

const worker = new Worker('knowledge-ingestion', processKnowledge, {
    connection: redisConnection,
    concurrency: 1,
    lockDuration: 300000, 
    lockRenewTime: 150000 
});

console.log('[KnowledgeWorker] ✔  Kuyruk dinleniyor → knowledge-ingestion (LockDuration: 5m, Audio Compression: ON)');

module.exports = worker;
