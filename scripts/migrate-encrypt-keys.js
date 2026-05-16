/**
 * Mevcut WorkspaceApiKey kayıtlarını AES-256-GCM ile şifreler.
 * enc: prefix'i olmayan (düz metin) key'leri bulur, şifreler, günceller.
 * Güvenli: zaten şifrelenmiş key'lere dokunmaz.
 *
 * Çalıştırma: node scripts/migrate-encrypt-keys.js
 */
require('dotenv').config();
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
    ? crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY).digest()
    : null;

if (!ENCRYPTION_KEY) {
    console.error('❌ ENCRYPTION_KEY .env\'de tanımlı değil. Önce ekle, sonra çalıştır.');
    process.exit(1);
}

function encrypt(text) {
    if (!text || text.startsWith('enc:')) return text;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `enc:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

async function main() {
    const rows = await prisma.workspaceApiKey.findMany();
    let migrated = 0;
    let skipped = 0;

    for (const row of rows) {
        if (!row.keyValue || row.keyValue.startsWith('enc:')) {
            skipped++;
            continue;
        }

        const encryptedValue = encrypt(row.keyValue);
        await prisma.workspaceApiKey.update({
            where: { workspaceId_provider: { workspaceId: row.workspaceId, provider: row.provider } },
            data: { keyValue: encryptedValue },
        });
        console.log(`✅ ${row.workspaceId.slice(0, 8)}... / ${row.provider} → şifrelendi`);
        migrated++;
    }

    console.log(`\nTamamlandı: ${migrated} şifrelendi, ${skipped} zaten şifreli / boş.`);
    await prisma.$disconnect();
}

main().catch(err => {
    console.error('Migration hatası:', err.message);
    process.exit(1);
});
