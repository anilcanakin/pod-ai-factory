const prisma = require('../lib/prisma');

async function runMemoryExpiry() {
    console.log('[MemoryExpiry] Süresi dolmuş Brain girişleri pasifleştiriliyor...');
    try {
        const result = await prisma.corporateMemory.updateMany({
            where: {
                isActive: true,
                expiresAt: { lte: new Date() },
            },
            data: { isActive: false },
        });
        console.log(`[MemoryExpiry] ${result.count} giriş pasifleştirildi.`);
        return result.count;
    } catch (err) {
        console.error('[MemoryExpiry] Hata:', err.message);
        return 0;
    }
}

function startCron() {
    // İlk çalışma: başlangıçta hemen bir kez
    runMemoryExpiry();

    // Her gece 02:00'de çalış
    const now = new Date();
    const next2am = new Date(now);
    next2am.setHours(2, 0, 0, 0);
    if (next2am <= now) next2am.setDate(next2am.getDate() + 1);

    const msUntil2am = next2am.getTime() - now.getTime();
    const oneDay = 24 * 60 * 60 * 1000;

    setTimeout(() => {
        runMemoryExpiry();
        setInterval(runMemoryExpiry, oneDay);
    }, msUntil2am);

    console.log(`[MemoryExpiry] Cron başlatıldı — sonraki çalışma: ${next2am.toISOString()}`);
}

module.exports = { startCron, runMemoryExpiry };
