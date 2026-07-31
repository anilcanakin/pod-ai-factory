// Mevcut (thumbnail-özelliği öncesi) kayıtlar için eksik -thumb.webp dosyalarını
// üretir. Idempotent: zaten var olan thumb'ları atlar, tekrar çalıştırmak güvenli.
//
// Kapsam (thumbnail hook'unun kapsadığı tüm URL alanları):
//   Image.imageUrl, Mockup.mockupUrl, MockupTemplate.baseImagePath,
//   PhotoTemplate.baseArtworkUrl, PersonalizationOrder.customerPhotoUrl,
//   PersonalizationOrder.customerPhotoUrls[], PersonalizationOrder.printFileUrl,
//   PersonalizationOrder.mockupUrl
//
// Kullanım: node scripts/backfill-thumbnails.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { generateThumbnail, toThumbStoragePath } = require('../src/services/storage.service');

const prisma = new PrismaClient();
const REPO_ROOT = path.join(__dirname, '..');
const BATCH_SIZE = 10; // aynı anda en fazla bu kadar dosya işlenir

// DB'deki URL değerini repo-root'a göre mutlak bir dosya yoluna çevirir.
// http(s) ile başlayan harici/CDN URL'ler için null döner — diskte karşılığı yok,
// indirmeden thumbnail üretilemez (script sadece "diskteki mevcut dosyadan" üretir).
function toLocalAbsPath(dbUrl) {
    if (!dbUrl || typeof dbUrl !== 'string') return null;
    if (/^https?:\/\//i.test(dbUrl)) return null;
    return path.join(REPO_ROOT, dbUrl.replace(/^\/+/, ''));
}

async function processOne(absPath) {
    const thumbAbsPath = toThumbStoragePath(absPath);
    if (fs.existsSync(thumbAbsPath)) return 'skipped-exists';
    if (!fs.existsSync(absPath)) return 'skipped-missing-source';
    await generateThumbnail(absPath, absPath);
    return fs.existsSync(thumbAbsPath) ? 'generated' : 'failed';
}

async function processAll(items) {
    const total = items.length;
    const counts = { generated: 0, 'skipped-exists': 0, 'skipped-missing-source': 0, 'skipped-external': 0, failed: 0 };

    for (let i = 0; i < total; i += BATCH_SIZE) {
        const chunk = items.slice(i, i + BATCH_SIZE);
        await Promise.all(chunk.map(async (item) => {
            const absPath = toLocalAbsPath(item.url);
            if (!absPath) { counts['skipped-external']++; return; }
            try {
                const status = await processOne(absPath);
                counts[status]++;
                if (status === 'failed') {
                    console.warn(`[Backfill] Üretilemedi: ${item.label}`);
                }
            } catch (err) {
                counts.failed++;
                console.warn(`[Backfill] Hata (${item.label}):`, err.message);
            }
        }));

        const done = Math.min(i + BATCH_SIZE, total);
        console.log(
            `[Backfill] ${done}/${total} tamamlandı — ` +
            `${counts.generated} üretildi, ${counts['skipped-exists']} zaten var, ` +
            `${counts['skipped-missing-source']} kaynak eksik, ${counts['skipped-external']} harici, ` +
            `${counts.failed} hata`
        );
    }

    return counts;
}

async function main() {
    console.log('[Backfill] Kayıtlar çekiliyor...');

    const [images, mockups, mockupTemplates, photoTemplates, orders] = await Promise.all([
        prisma.image.findMany({ select: { id: true, imageUrl: true } }),
        prisma.mockup.findMany({ select: { id: true, mockupUrl: true } }),
        prisma.mockupTemplate.findMany({ select: { id: true, baseImagePath: true } }),
        prisma.photoTemplate.findMany({ select: { id: true, baseArtworkUrl: true } }),
        prisma.personalizationOrder.findMany({
            select: { id: true, customerPhotoUrl: true, customerPhotoUrls: true, printFileUrl: true, mockupUrl: true },
        }),
    ]);

    const items = [];
    for (const r of images) {
        if (r.imageUrl) items.push({ url: r.imageUrl, label: `Image.imageUrl#${r.id}` });
    }
    for (const r of mockups) {
        if (r.mockupUrl) items.push({ url: r.mockupUrl, label: `Mockup.mockupUrl#${r.id}` });
    }
    for (const r of mockupTemplates) {
        if (r.baseImagePath) items.push({ url: r.baseImagePath, label: `MockupTemplate.baseImagePath#${r.id}` });
    }
    for (const r of photoTemplates) {
        if (r.baseArtworkUrl) items.push({ url: r.baseArtworkUrl, label: `PhotoTemplate.baseArtworkUrl#${r.id}` });
    }
    for (const r of orders) {
        if (r.customerPhotoUrl) items.push({ url: r.customerPhotoUrl, label: `PersonalizationOrder.customerPhotoUrl#${r.id}` });
        if (r.printFileUrl) items.push({ url: r.printFileUrl, label: `PersonalizationOrder.printFileUrl#${r.id}` });
        if (r.mockupUrl) items.push({ url: r.mockupUrl, label: `PersonalizationOrder.mockupUrl#${r.id}` });
        if (Array.isArray(r.customerPhotoUrls)) {
            r.customerPhotoUrls.forEach((u, idx) => {
                if (typeof u === 'string' && u) {
                    items.push({ url: u, label: `PersonalizationOrder.customerPhotoUrls[${idx}]#${r.id}` });
                }
            });
        }
    }

    console.log(
        `[Backfill] Toplam ${items.length} URL bulundu ` +
        `(${images.length} Image, ${mockups.length} Mockup, ${mockupTemplates.length} MockupTemplate, ` +
        `${photoTemplates.length} PhotoTemplate, ${orders.length} PersonalizationOrder).`
    );

    const summary = await processAll(items);
    console.log('[Backfill] Bitti:', summary);
}

main()
    .catch((err) => {
        console.error('[Backfill] Beklenmeyen hata:', err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
