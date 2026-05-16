const cron    = require('node-cron');
const prisma  = require('../lib/prisma');
const { scanAllStores } = require('../services/power-seller-monitor.service');

const INITIAL_DELAY_MS = 2 * 60 * 1000; // sunucu başlangıcından 2dk sonra

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
    // Her 6 saatte bir çalıştır
    cron.schedule('0 */6 * * *', runScan);
    console.log('[PowerSeller Cron] ✅ Her 6 saatte bir aktif.');

    // Başlangıçta gecikmeli çalıştır
    setTimeout(runScan, INITIAL_DELAY_MS);
}

module.exports = { startCron, runScan };
