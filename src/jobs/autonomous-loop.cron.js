const prisma = require('../lib/prisma');
const { runLoop } = require('../services/autonomous-loop.service');

const CRON_HOUR   = 3;  // Her gece 03:00
const INTERVAL_MS = 24 * 60 * 60 * 1000;

async function runAllWorkspaces() {
    console.log('[AutoLoop Cron] Tüm workspace döngüleri başladı...');
    let workspaceIds;
    try {
        const ws = await prisma.workspace.findMany({ select: { id: true } });
        workspaceIds = ws.map(w => w.id);
    } catch {
        workspaceIds = ['default-workspace'];
    }

    for (const id of workspaceIds) {
        try {
            await runLoop(id);
        } catch (err) {
            console.error(`[AutoLoop Cron] ${id} hatası:`, err.message);
        }
    }
}

function getMsUntilNextRun() {
    const now  = new Date();
    const next = new Date();
    next.setHours(CRON_HOUR, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
}

function startCron() {
    const delay = getMsUntilNextRun();
    const nextAt = new Date(Date.now() + delay).toLocaleTimeString('tr-TR');

    setTimeout(() => {
        runAllWorkspaces();
        setInterval(runAllWorkspaces, INTERVAL_MS);
    }, delay);

    console.log(`[AutoLoop Cron] ✅ Aktif — sonraki çalışma: ${nextAt}`);
}

module.exports = { startCron, runAllWorkspaces };
