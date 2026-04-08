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
 * Upload from URL (download then upload)
 */
async function uploadUrlToStorage(imageUrl, storagePath) {
    const fetch = require('node-fetch');
    const response = await fetch(imageUrl);
    const buffer = await response.buffer();

    const { data, error } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, buffer, {
            contentType: 'image/png',
            upsert: true
        });

    if (error) throw error;

    const { data: urlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(storagePath);

    return urlData.publicUrl;
}

module.exports = { uploadToStorage, uploadUrlToStorage };
