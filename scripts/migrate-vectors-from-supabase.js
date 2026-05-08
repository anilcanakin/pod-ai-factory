/**
 * Tek seferlik vektör embedding taşıma scripti
 * Supabase CorporateMemory → Yerel Postgres
 *
 * Kullanım:
 *   node scripts/migrate-vectors-from-supabase.js
 *
 * Gerekli .env değişkenleri:
 *   SUPABASE_URL        — Supabase proje URL'si (https://xxx.supabase.co)
 *   SUPABASE_SERVICE_KEY — Supabase service role secret key
 *   DATABASE_URL        — Yerel Postgres bağlantı dizesi (hedef)
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const { PrismaClient }  = require('@prisma/client');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[migrate] SUPABASE_URL veya SUPABASE_SERVICE_KEY .env dosyasında eksik.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const prisma   = new PrismaClient();

const PAGE_SIZE = 100;

async function main() {
    console.log('[migrate] Supabase → Yerel Postgres vektör taşıma başlıyor...');
    console.log(`[migrate] Kaynak: ${SUPABASE_URL}`);
    console.log(`[migrate] Hedef:  ${process.env.DATABASE_URL?.split('@')[1] || 'local'}\n`);

    let offset       = 0;
    let totalFetched = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalMissing = 0;

    // Supabase'deki tüm kayıtları sayfalı çek
    while (true) {
        const { data, error } = await supabase
            .from('CorporateMemory')
            .select('id, title, vectorEmbedding')
            .not('vectorEmbedding', 'is', null)
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
            console.error('[migrate] Supabase sorgu hatası:', error.message);
            break;
        }
        if (!data || data.length === 0) break;

        totalFetched += data.length;
        console.log(`[migrate] Sayfa ${Math.floor(offset / PAGE_SIZE) + 1}: ${data.length} kayıt alındı`);

        for (const record of data) {
            const embedding = record.vectorEmbedding;

            // Gelen değer array olmalı (PostgREST JSONB'yi JS array olarak döndürür)
            if (!Array.isArray(embedding) || embedding.length === 0) {
                console.warn(`[migrate] ⚠ ${record.id} — geçersiz embedding formatı, atlandı`);
                totalSkipped++;
                continue;
            }

            // Yerel DB'de bu ID var mı?
            const exists = await prisma.corporateMemory.findUnique({
                where: { id: record.id },
                select: { id: true, vectorEmbedding: true },
            });

            if (!exists) {
                console.warn(`[migrate] ⚠ ${record.id} (${record.title?.slice(0, 40)}) yerel DB'de yok — atlandı`);
                totalMissing++;
                continue;
            }

            // Zaten doluysa güncelleme
            await prisma.corporateMemory.update({
                where: { id: record.id },
                data:  { vectorEmbedding: embedding },
            });

            totalUpdated++;
            if (totalUpdated % 10 === 0) {
                process.stdout.write(`[migrate]   ${totalUpdated} kayıt güncellendi...\r`);
            }
        }

        offset += data.length;
        if (data.length < PAGE_SIZE) break; // son sayfa
    }

    console.log('\n');
    console.log('═══════════════════════════════════════');
    console.log('[migrate] Taşıma tamamlandı');
    console.log(`  Supabase'den çekildi : ${totalFetched}`);
    console.log(`  Yerel DB güncellendi : ${totalUpdated}`);
    console.log(`  Yerel DB'de yok      : ${totalMissing}`);
    console.log(`  Geçersiz embedding   : ${totalSkipped}`);
    console.log('═══════════════════════════════════════');

    if (totalMissing > 0) {
        console.log('\n[migrate] NOT: Yerel DB\'de olmayan kayıtlar için önce tam veri migrasyonu');
        console.log('[migrate] yapılması gerekebilir (pg_dump → pg_restore veya Prisma seed).');
    }
}

main()
    .catch(err => {
        console.error('[migrate] Beklenmeyen hata:', err.message);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
