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

module.exports = { uploadToStorage, uploadUrlToStorage };
