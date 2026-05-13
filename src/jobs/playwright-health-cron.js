const { checkPublishHealth } = require('../services/playwright-monitor.service');
const prisma = require('../lib/prisma');

const INTERVAL_MS = 60 * 60 * 1000; // saatte bir

async function runHealthCheck() {
    try {
        const workspaces = await prisma.workspace.findMany({ select: { id: true } });
        for (const ws of workspaces) {
            await checkPublishHealth(ws.id);
        }
    } catch (err) {
        console.error('[PlaywrightHealthCron] Hata:', err.message);
    }
}

function startCron() {
    console.log('[PlaywrightHealthCron] Başlatıldı — saatlik Playwright sağlık kontrolü aktif.');
    setInterval(runHealthCheck, INTERVAL_MS);
}

module.exports = { startCron, runHealthCheck };
