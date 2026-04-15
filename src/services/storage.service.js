const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const BUCKET = 'mockup-outputs';

/**
 * Upload a local file to Supabase Storage
 * Returns the public URL
 */
async function uploadToStorage(localFilePath, storagePath) {
    try {
        const fileBuffer = fs.readFileSync(localFilePath);
        const contentType = localFilePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

        const { data, error } = await supabase.storage
            .from(BUCKET)
            .upload(storagePath, fileBuffer, {
                contentType,
                upsert: true
            });

        if (error) throw error;

        const { data: urlData } = supabase.storage
            .from(BUCKET)
            .getPublicUrl(storagePath);

        return urlData.publicUrl;

    } catch (err) {
        console.error('[Storage] Upload failed:', err.message);
        throw err;
    }
}

/**
 * Upload from URL (download then upload to Supabase for permanent hosting)
 */
async function uploadUrlToStorage(imageUrl, storagePath) {
    const fetch = require('node-fetch');
    const response = await fetch(imageUrl);

    if (!response.ok) {
        throw new Error(`[Storage] Failed to fetch image from URL (${response.status}): ${imageUrl}`);
    }

    // Detect real content type from response headers instead of hardcoding 'image/png'
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.buffer();

    const { data, error } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, buffer, {
            contentType,
            upsert: true
        });

    if (error) throw error;

    const { data: urlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(storagePath);

    return urlData.publicUrl;
}

/**
 * QA tarafından reddedilen görseli küçük thumbnail olarak Supabase'in
 * rejected_assets/ klasörüne kaydet.
 * — Sharp ile 512×512 sınırına resize, JPEG quality:55 (ucuz depolama)
 * — Kalıcı referans: Gallery'de FAL'ın geçici URL'si yerine bu kullanılır
 */
async function uploadRejectedToStorage(imageUrl, storagePath) {
    const fetch = require('node-fetch');
    const sharp = require('sharp');

    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error(`[Storage/Rejected] Fetch failed (${response.status}): ${imageUrl}`);
    }

    const rawBuffer = await response.buffer();

    // Thumbnail: en fazla 512×512, oranı koru, JPEG %55 kalite
    const thumbnail = await sharp(rawBuffer)
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 55 })
        .toBuffer();

    const { error } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, thumbnail, {
            contentType: 'image/jpeg',
            upsert: true
        });

    if (error) throw error;

    const { data: urlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(storagePath);

    return urlData.publicUrl;
}

/**
 * Upload a raw Buffer directly to Supabase Storage (no intermediate fetch needed).
 * Used by ImageRouter to stage Genai-generated images as real HTTPS URLs
 * before they flow into QA, RMBG, and the final storage step.
 *
 * @param {Buffer} buffer
 * @param {string} storagePath  - e.g. 'temp_genai/xyz.png'
 * @param {string} contentType  - e.g. 'image/png'
 * @returns {Promise<string>}   - Supabase public URL
 */
async function uploadBufferToStorage(buffer, storagePath, contentType = 'image/png') {
    const { error } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, buffer, { contentType, upsert: true });

    if (error) throw new Error(`[Storage] Buffer upload failed: ${error.message}`);

    const { data: urlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(storagePath);

    return urlData.publicUrl;
}

module.exports = { uploadToStorage, uploadUrlToStorage, uploadRejectedToStorage, uploadBufferToStorage };
