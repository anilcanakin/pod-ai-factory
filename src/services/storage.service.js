const fs   = require('fs');
const path = require('path');

// Tüm yüklenen dosyalar assets/uploads/ altına kaydedilir.
// Bu dizin index.js'te /assets/uploads/* olarak statik servis edilir.
const UPLOADS_ROOT = path.join(__dirname, '../../assets/uploads');

if (!fs.existsSync(UPLOADS_ROOT)) {
    fs.mkdirSync(UPLOADS_ROOT, { recursive: true });
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Herhangi bir path'in (mutlak ya da göreli) uzantısını "-thumb.webp" ile
// değiştirir. Path-agnostic saf string işlemi — hem "generated/x.png" hem
// "C:\...\assets\mockups\tshirt\id\base.png" için aynı şekilde çalışır.
// storagePath örneği: "generated/abc123_1234567890.png" → "generated/abc123_1234567890-thumb.webp"
function toThumbStoragePath(storagePath) {
    return storagePath.replace(/\.[^/.]+$/, '-thumb.webp');
}

/**
 * input: Buffer veya yerel dosya yolu (Sharp ikisini de kabul eder).
 * destAbsPath: orijinal dosyanın MUTLAK yolu — thumbnail bunun yanına (aynı
 * dizine) "-thumb.webp" olarak yazılır. Dosyanın assets/uploads/ altında mı
 * yoksa (MockupTemplate gibi) başka bir assets/ alt ağacında mı olduğu
 * önemli değil; her zaman kaynağın sibling'i olarak üretilir — frontend'in
 * toThumbUrl() (aynı dizin, uzantı değişir) beklentisiyle birebir eşleşir.
 * Hata thumbnail'i asla ana upload'ı kırmaz — sadece loglanır.
 */
async function generateThumbnail(input, destAbsPath) {
    try {
        const sharp = require('sharp');
        const thumbAbsPath = toThumbStoragePath(destAbsPath);
        ensureDir(path.dirname(thumbAbsPath));
        await sharp(input)
            .resize(400, null, { withoutEnlargement: true })
            .webp({ quality: 72 })
            .toFile(thumbAbsPath);
    } catch (err) {
        console.warn('[Storage] Thumbnail üretilemedi:', err.message);
    }
}

// storagePath örneği: "generated/abc123_1234567890.png"
// Dönen URL    örneği: "assets/uploads/generated/abc123_1234567890.png"
// Frontend'deki resolveUrl() bu değerin önüne API_BASE ekler.
function toPublicUrl(storagePath) {
    return `assets/uploads/${storagePath}`;
}

/**
 * Yerel bir dosyayı uploads klasörüne kopyalar.
 * Eski imza: uploadToStorage(localFilePath, storagePath)
 */
async function uploadToStorage(localFilePath, storagePath) {
    const dest = path.join(UPLOADS_ROOT, storagePath);
    ensureDir(path.dirname(dest));
    fs.copyFileSync(localFilePath, dest);
    console.log('[Storage] Dosya kopyalandı:', dest);
    await generateThumbnail(dest, dest);
    return toPublicUrl(storagePath);
}

/**
 * Bir URL'den görseli indirir ve uploads klasörüne kaydeder.
 * Eski imza: uploadUrlToStorage(imageUrl, storagePath)
 */
async function uploadUrlToStorage(imageUrl, storagePath) {
    const fetch = require('node-fetch');
    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error(`[Storage] Görsel indirilemedi (${response.status}): ${imageUrl}`);
    }
    const buffer = await response.buffer();
    const dest = path.join(UPLOADS_ROOT, storagePath);
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, buffer);
    console.log('[Storage] URL kaydedildi:', dest);
    await generateThumbnail(buffer, dest);
    return toPublicUrl(storagePath);
}

/**
 * Reddedilen görseli 512×512 JPEG thumbnail olarak kaydeder.
 * Eski imza: uploadRejectedToStorage(imageUrl, storagePath)
 */
async function uploadRejectedToStorage(imageUrl, storagePath) {
    const fetch = require('node-fetch');
    const sharp = require('sharp');

    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error(`[Storage/Rejected] Görsel indirilemedi (${response.status}): ${imageUrl}`);
    }
    const rawBuffer = await response.buffer();

    const thumbnail = await sharp(rawBuffer)
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 55 })
        .toBuffer();

    const dest = path.join(UPLOADS_ROOT, storagePath);
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, thumbnail);
    console.log('[Storage] Reddedilen thumbnail kaydedildi:', dest);
    return toPublicUrl(storagePath);
}

/**
 * Bir Buffer'ı doğrudan uploads klasörüne yazar.
 * Eski imza: uploadBufferToStorage(buffer, storagePath, contentType)
 */
async function uploadBufferToStorage(buffer, storagePath, contentType = 'image/png') {
    const dest = path.join(UPLOADS_ROOT, storagePath);
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, buffer);
    console.log('[Storage] Buffer kaydedildi:', dest);
    await generateThumbnail(buffer, dest);
    return toPublicUrl(storagePath);
}

module.exports = {
    uploadToStorage,
    uploadUrlToStorage,
    uploadRejectedToStorage,
    uploadBufferToStorage,
    generateThumbnail,
    toThumbStoragePath,
};
