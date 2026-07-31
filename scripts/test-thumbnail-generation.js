// Manuel doğrulama: uploadToStorage/uploadBufferToStorage çağrıldığında
// yanında bir -thumb.webp dosyası da oluşuyor mu?
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const sharp = require('sharp');
const { uploadBufferToStorage } = require('../src/services/storage.service');

async function main() {
    // 1x1 kırmızı piksel PNG (Sharp ile üretildi — harici dosyaya bağımlı değil)
    const pngBuffer = await sharp({
        create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 0, b: 0 } }
    }).png().toBuffer();

    const storagePath = `test/thumb-check-${Date.now()}.png`;
    const publicUrl = await uploadBufferToStorage(pngBuffer, storagePath);
    console.log('Original URL:', publicUrl);

    const thumbPath = path.join(__dirname, '../assets/uploads', storagePath.replace(/\.png$/, '-thumb.webp'));
    assert(fs.existsSync(thumbPath), `Thumbnail oluşmadı: ${thumbPath}`);
    const stats = fs.statSync(thumbPath);
    assert(stats.size > 0, 'Thumbnail dosyası boş');
    console.log('✓ Thumbnail oluştu:', thumbPath, `(${stats.size} bytes)`);

    // Cleanup
    fs.unlinkSync(path.join(__dirname, '../assets/uploads', storagePath));
    fs.unlinkSync(thumbPath);
}

main().catch(err => { console.error('✗ FAILED:', err.message); process.exit(1); });
