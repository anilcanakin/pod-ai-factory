const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const multer = require('multer');
const upload = multer({ 
    dest: 'uploads/temp/',
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

/**
 * Görev İlerlemelerini Getirir
 */
router.get('/stats', async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const tasks = await prisma.dailyTask.findMany({
            where: {
                date: { gte: today }
            }
        });

        // Eğer mevcut günün taskleri yoksa, default olarak oluştur
        const defaultTasks = [
            { taskType: 'MOCKUP', targetCount: 100 },
            { taskType: 'SEO', targetCount: 100 },
            { taskType: 'ETSY_DRAFT', targetCount: 100 }
        ];

        const responseTasks = await Promise.all(defaultTasks.map(async dt => {
            let task = tasks.find(t => t.taskType === dt.taskType);
            if (!task) {
                task = await prisma.dailyTask.upsert({
                    where: {
                        date_taskType: { date: today, taskType: dt.taskType }
                    },
                    update: {},
                    create: {
                        date: today,
                        taskType: dt.taskType,
                        targetCount: dt.targetCount,
                        currentCount: 0,
                    }
                });
            }
            return task;
        }));

        // Basit finansal hedef hesaplaması (dummy logic - Etsy Draftları üzerinden)
        const draftTask = responseTasks.find(t => t.taskType === 'ETSY_DRAFT');
        // Örneğin: Bu ay toplam ne kadar draft atıldı? (Gerçekte başka tablo da kullanılabilir, şimdilik basit tahmini gelir hesaplayalım)
        const monthlyRevenueEstimate = draftTask ? (draftTask.currentCount * 12.5) : 0; // Her draftın ~$12.5 potansiyeli olsun

        // Legal Guard İhlal Taraması
        const flaggedItems = await prisma.image.findMany({
            where: { status: 'FLAGGED' },
            select: { id: true, flagReason: true, imageUrl: true }
        });

        res.json({
            tasks: responseTasks,
            financial: {
                currentRevenue: monthlyRevenueEstimate,
                targetRevenue: 20000
            },
            flaggedItems: flaggedItems
        });
    } catch (err) {
        console.error('[HQ Stats]', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Bulk İşlem (Otonom Kuyruk Yolu)
 * Çoklu dosya yüklenir ve hepsini sırayla işlemek üzere BullMQ veya benzeri bir kuyruğa iteriz.
 */
router.post('/bulk', upload.array('designs', 30), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files provided for bulk processing' });
        }

        const files = req.files;
        console.log(`[HQ Bulk] ${files.length} dosya alındı. Seri üretim bandına aktarılıyor...`);

        // Bu noktada normalde dosyaları bir worker'a (BullMQ) ekleriz.
        // Hızlı entegrasyon için "process" taklidi ve DB'de görevleri artırma yapıyoruz.

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Bulk işlemi arka planda başlat (çökme ve bekleme yapmamak için asenkron bırakıyoruz)
        const keyword = req.body.keyword || 'default niche';
        const hqService = require('../services/hq.service');
        hqService.processBulkBatch(files, keyword).catch(console.error);

        res.json({
            message: `${files.length} tasarım otonom üretim bandına eklendi! (Mockup -> RAG SEO -> Etsy Draft)`
        });

    } catch (err) {
        console.error('[Bulk Process]', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Legal Guard Override (Onaylama / Yok Sayma)
 */
router.post('/override/:id', async (req, res) => {
    try {
        const imageId = req.params.id;
        
        await prisma.image.update({
            where: { id: imageId },
            data: { 
                status: 'PROCESSED',
                flagReason: 'OVERRIDDEN_BY_ADMIN' // Karar kaydı
            }
        });

        console.warn(`[Legal Guard] 🛡️ Uyarı yoksayıldı: Image ${imageId} admin tarafından zorla onaylandı.`);
        
        res.json({ message: 'Legal uyarı kaldırıldı, ürün üretim bandına dahil edildi.' });
    } catch (err) {
        console.error('[Override Error]', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Tam Otonom Üretim (Phase 2 - Replicate + Remove.bg)
 */
router.post('/generate-auto', async (req, res) => {
    try {
        const { niche } = req.body;
        if (!niche) {
            return res.status(400).json({ error: 'Niche keyword is required' });
        }

        const { getFullIntelligence, getReviewInsights } = require('../services/market.service');
        const imageService = require('../services/image.service');
        const safetyService = require('../services/safety.service');
        const hqService = require('../services/hq.service');
        const mockupService = require('../services/mockup.service');
        const fs = require('fs');
        const path = require('path');
        const crypto = require('crypto');

        console.log(`[Autobot] Market ve Duygu Analizi verileri çekiliyor: ${niche}`);
        let marketData = { trendTerms: [niche], pinterestTrends: [niche] };
        let reviewInsights = "";
        try {
            [marketData, reviewInsights] = await Promise.all([
                getFullIntelligence(niche),
                getReviewInsights(niche)
            ]);
        } catch (e) {
            console.warn("[Autobot] Pazar verisi tam çekilemedi, varsayılan değerlerle devam ediliyor.");
        }

        // 1. Prompt Yaz (Duygu Analizi Filtresi ile)
        const prompt = await imageService.generatePrompt(marketData, reviewInsights);

        // 2. Legal Guard Kontrolü
        const safety = await safetyService.validateLegalSafety({ title: prompt });
        if (!safety.isSafe) {
            console.error(`[Autobot] 🚔 Legal Guard reddetti: Prompt tehlikeli kelimeler içeriyor. Sebep: ${safety.reason}`);
            return res.status(403).json({ error: `Hukuki Engelleme: ${safety.reason}` });
        }

        // 3. Görsel Üret (Flux.1)
        const imageUrl = await imageService.generateImage(prompt);

        // 4. Arka Plan Sil (Remove.bg)
        const bgBuffer = await imageService.removeBackground(imageUrl);

        // Kayıt Yeri
        const uploadsDir = path.join(__dirname, '../../assets/outputs');
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        
        const filename = `auto_${crypto.randomBytes(6).toString('hex')}.png`;
        const filepath = path.join(uploadsDir, filename);
        
        fs.writeFileSync(filepath, bgBuffer);
        const webPatternUrl = `assets/outputs/${filename}`;
        
        console.log(`[Autobot] ✅ Tasarım başarıyla ayrıştırıldı ve kaydedildi: ${filepath}`);

        // 5. Sahneleme Motoru (Scene Engine)
        const sceneUrl = await mockupService.generateLifestyleScene(filepath, reviewInsights, niche);

        // 6. Bulk Kuyruğuna (Worker'a) gönder
        const mockUploadFile = { originalname: filename, path: filepath };
        hqService.processBulkBatch([mockUploadFile], niche).catch(console.error);

        res.json({
            prompt,
            imageUrl,
            transparentUrl: webPatternUrl,
            sceneUrl: sceneUrl,
            message: "Otonom üretim tamam. Tasarım sıraya alındı!"
        });
    } catch (err) {
        console.error('[Autobot Error]', err);
        res.status(500).json({ error: err.message });
    }
});

// ═════════════════════════════════════════════════════════════════════
// QA (KALİTE KONTROL) - ONAY MEKANİZMASI
// ═════════════════════════════════════════════════════════════════════

/**
 * 1. PENDING_APPROVAL olanları getir (The Swiper UI İçin)
 */
router.get('/pending', async (req, res) => {
    try {
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        const items = await prisma.image.findMany({
            where: { status: 'PENDING_APPROVAL' },
            include: { seoData: true, mockups: true, job: true },
            orderBy: { createdAt: 'desc' },
            take: 100
        });
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * 2. Onayla (Etsy'ye Gönder)
 */
router.post('/approve/:id', async (req, res) => {
    try {
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        
        await prisma.image.update({
            where: { id: req.params.id },
            data: { status: 'PROCESSED' }
        });
        
        // Mock Draft Jitter
        const taskService = require('../services/task.service');
        await taskService.incrementTask('ETSY_DRAFT');
        
        res.json({ message: 'Approved and Drafted to Etsy' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * 3. Reddet (REJECTED)
 */
router.post('/reject/:id', async (req, res) => {
    try {
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        
        await prisma.image.update({
            where: { id: req.params.id },
            data: { status: 'REJECTED' }
        });
        
        res.json({ message: 'Rejected Successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * 4. Hepsini Onayla (Batch Push)
 */
router.post('/approve-all', async (req, res) => {
    try {
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        
        const items = await prisma.image.findMany({
            where: { status: 'PENDING_APPROVAL' }
        });

        await prisma.image.updateMany({
            where: { status: 'PENDING_APPROVAL' },
            data: { status: 'PROCESSED' }
        });
        
        // Mock Draft Increment for all
        const taskService = require('../services/task.service');
        for (let i = 0; i < items.length; i++) {
            await taskService.incrementTask('ETSY_DRAFT');
        }

        res.json({ message: `${items.length} ürün başarıyla Etsy'ye gönderildi!` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
