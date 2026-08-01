const prisma  = require('../lib/prisma');
const { scanAllStores } = require('../services/power-seller-monitor.service');

const INTERVAL_MS      = 6 * 60 * 60 * 1000; // 6 saatte bir
const INITIAL_DELAY_MS = 2 * 60 * 1000;       // sunucu başlangıcından 2dk sonra

async function runScan() {
    console.log('[PowerSeller Cron] Tarama başladı...');

    let workspaceIds;
    try {
        const workspaces = await prisma.workspace.findMany({ select: { id: true } });
        workspaceIds     = workspaces.map(w => w.id);
    } catch {
        workspaceIds = ['default-workspace'];
    }

    for (const workspaceId of workspaceIds) {
        try {
            const result = await scanAllStores(workspaceId);
            if (result.scanned > 0) {
                console.log(`[PowerSeller Cron] ${workspaceId}: ${result.scanned} mağaza, ${result.totalAlerts} alert`);
            }
        } catch (err) {
            console.error(`[PowerSeller Cron] ${workspaceId} hata:`, err.message);
        }
    }
}

function startCron() {
    if (process.env.STAGING_MODE === 'true') {
        console.log('[PowerSeller Cron] STAGING_MODE aktif — gerçek Etsy mağaza taramasına dokunmamak için cron devre dışı.');
        return;
    }
    setTimeout(() => {
        runScan();
        setInterval(runScan, INTERVAL_MS);
    }, INITIAL_DELAY_MS);

    console.log('[PowerSeller Cron] ✅ Her 6 saatte bir aktif.');
}

module.exports = { startCron, runScan };
