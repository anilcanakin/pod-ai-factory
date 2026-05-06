/**
 * Tam Brain Migrasyonu: Supabase → Yerel Postgres
 * CorporateMemory + SeoKnowledgeBase kayıtlarını taşır.
 *
 * Kullanım:
 *   node scripts/migrate-full-brain.js
 *
 * .env değişkenleri:
 *   SUPABASE_URL         — Kaynak Supabase URL
 *   SUPABASE_SERVICE_KEY — Supabase service role key
 *   DATABASE_URL         — Hedef yerel Postgres URL
 *   TARGET_WORKSPACE_ID  — (opsiyonel) Yerel workspace ID; belirtilmezse ilk workspace kullanılır
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

// ── Yardımcı: sayfalı Supabase sorgusu ───────────────────────────────────────
async function fetchAll(table, columns = '*') {
    const rows = [];
    let offset = 0;
    while (true) {
        const { data, error } = await supabase
            .from(table)
            .select(columns)
            .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw new Error(`${table} sorgu hatası: ${error.message}`);
        if (!data || data.length === 0) break;
        rows.push(...data);
        console.log(`  [${table}] ${rows.length} kayıt alındı...`);
        if (data.length < PAGE_SIZE) break;
        offset += data.length;
    }
    return rows;
}

// ── CorporateMemory ───────────────────────────────────────────────────────────
async function migrateCorporateMemory(localWorkspaceId) {
    console.log('\n[1/2] CorporateMemory taşınıyor...');
    const rows = await fetchAll('CorporateMemory',
        'id,workspaceId,type,sourceType,title,content,category,tags,analysisResult,vectorEmbedding,sourceUrl,isActive,createdAt,updatedAt'
    );
    console.log(`  Supabase'den ${rows.length} kayıt alındı.`);

    let upserted = 0, skipped = 0, failed = 0;

    for (const r of rows) {
        try {
            await prisma.corporateMemory.upsert({
                where: { id: r.id },
                create: {
                    id:              r.id,
                    workspaceId:     localWorkspaceId,
                    type:            r.type             ?? 'ARTICLE',
                    sourceType:      r.sourceType       ?? 'Market',
                    title:           r.title            ?? '(başlıksız)',
                    content:         r.content          ?? '',
                    category:        r.category         ?? 'general_etsy',
                    tags:            Array.isArray(r.tags) ? r.tags : [],
                    analysisResult:  r.analysisResult   ?? null,
                    vectorEmbedding: r.vectorEmbedding  ?? null,
                    sourceUrl:       r.sourceUrl        ?? null,
                    isActive:        r.isActive         ?? true,
                    createdAt:       r.createdAt ? new Date(r.createdAt) : new Date(),
                    updatedAt:       r.updatedAt ? new Date(r.updatedAt) : new Date(),
                },
                update: {
                    type:            r.type             ?? 'ARTICLE',
                    sourceType:      r.sourceType       ?? 'Market',
                    title:           r.title            ?? '(başlıksız)',
                    content:         r.content          ?? '',
                    category:        r.category         ?? 'general_etsy',
                    tags:            Array.isArray(r.tags) ? r.tags : [],
                    analysisResult:  r.analysisResult   ?? null,
                    vectorEmbedding: r.vectorEmbedding  ?? null,
                    sourceUrl:       r.sourceUrl        ?? null,
                    isActive:        r.isActive         ?? true,
                    updatedAt:       r.updatedAt ? new Date(r.updatedAt) : new Date(),
                },
            });
            upserted++;
            if (upserted % 50 === 0) process.stdout.write(`  ${upserted}/${rows.length} tamamlandı...\r`);
        } catch (err) {
            console.warn(`\n  ⚠ ${r.id} (${r.title?.slice(0, 40)}) atlandı: ${err.message}`);
            failed++;
        }
    }

    console.log(`\n  ✅ CorporateMemory: ${upserted} upsert, ${skipped} atlandı, ${failed} hata`);
    return { total: rows.length, upserted, skipped, failed };
}

// ── SeoKnowledgeBase ──────────────────────────────────────────────────────────
async function migrateSeoKnowledge(localWorkspaceId) {
    console.log('\n[2/2] SeoKnowledgeBase taşınıyor...');
    const rows = await fetchAll('SeoKnowledgeBase',
        'id,workspaceId,content,source,version,isActive,createdAt,updatedAt'
    );
    console.log(`  Supabase'den ${rows.length} kayıt alındı.`);

    let upserted = 0, failed = 0;

    for (const r of rows) {
        try {
            await prisma.seoKnowledgeBase.upsert({
                where: { id: r.id },
                create: {
                    id:          r.id,
                    workspaceId: localWorkspaceId,
                    content:     r.content  ?? '',
                    source:      r.source   ?? 'auto',
                    version:     r.version  ?? 1,
                    isActive:    r.isActive ?? false,
                    createdAt:   r.createdAt ? new Date(r.createdAt) : new Date(),
                    updatedAt:   r.updatedAt ? new Date(r.updatedAt) : new Date(),
                },
                update: {
                    content:     r.content  ?? '',
                    source:      r.source   ?? 'auto',
                    version:     r.version  ?? 1,
                    isActive:    r.isActive ?? false,
                    updatedAt:   r.updatedAt ? new Date(r.updatedAt) : new Date(),
                },
            });
            upserted++;
        } catch (err) {
            console.warn(`  ⚠ SeoKnowledge ${r.id} atlandı: ${err.message}`);
            failed++;
        }
    }

    console.log(`  ✅ SeoKnowledgeBase: ${upserted} upsert, ${failed} hata`);
    return { total: rows.length, upserted, failed };
}

// ── Ana akış ─────────────────────────────────────────────────────────────────
async function main() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  POD AI Factory — Tam Brain Migrasyonu');
    console.log(`  Kaynak: ${SUPABASE_URL}`);
    console.log(`  Hedef:  ${process.env.DATABASE_URL?.split('@')[1] || 'local'}`);
    console.log('═══════════════════════════════════════════════════════\n');

    // Yerel workspace ID'yi belirle
    const targetId = process.env.TARGET_WORKSPACE_ID;
    let localWorkspaceId;

    if (targetId) {
        localWorkspaceId = targetId;
        console.log(`[workspace] TARGET_WORKSPACE_ID: ${localWorkspaceId}`);
    } else {
        const ws = await prisma.workspace.findFirst({ select: { id: true, name: true } });
        if (!ws) {
            console.error('[workspace] Yerel DB\'de hiç workspace yok. Önce login yapıp workspace oluştur.');
            process.exit(1);
        }
        localWorkspaceId = ws.id;
        console.log(`[workspace] Otomatik seçildi: "${ws.name}" (${ws.id})`);
    }

    const cm  = await migrateCorporateMemory(localWorkspaceId);
    const seo = await migrateSeoKnowledge(localWorkspaceId);

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  Migrasyon Tamamlandı');
    console.log(`  CorporateMemory : ${cm.upserted}/${cm.total} başarılı`);
    console.log(`  SeoKnowledgeBase: ${seo.upserted}/${seo.total} başarılı`);
    console.log('═══════════════════════════════════════════════════════');

    if (cm.failed > 0 || seo.failed > 0) {
        console.warn('\n  ⚠ Bazı kayıtlar taşınamadı — yukarıdaki uyarıları incele.');
    }
}

main()
    .catch(err => {
        console.error('\n[migrate] Beklenmeyen hata:', err.message);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
