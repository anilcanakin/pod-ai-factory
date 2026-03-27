const { autoUpdateKnowledge } = require('../services/seo-knowledge.service');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function runWeeklyUpdate() {
    console.log('[SEO Cron] Weekly knowledge update starting...');
    try {
        const workspaces = await prisma.workspace.findMany({
            select: { id: true }
        });

        for (const ws of workspaces) {
            try {
                await autoUpdateKnowledge(ws.id);
                console.log(`[SEO Cron] Updated workspace: ${ws.id}`);
                // Rate limit için bekle
                await new Promise(r => setTimeout(r, 2000));
            } catch (err) {
                console.error(`[SEO Cron] Failed for workspace ${ws.id}:`, err.message);
            }
        }

        console.log('[SEO Cron] Weekly update complete');
    } catch (err) {
        console.error('[SEO Cron] Update failed:', err.message);
    }
}

// Her Pazartesi sabah 03:00'da çalış
function startCron() {
    const now = new Date();
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + (1 + 7 - now.getDay()) % 7 || 7);
    nextMonday.setHours(3, 0, 0, 0);

    const msUntilMonday = nextMonday.getTime() - now.getTime();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;

    console.log(`[SEO Cron] Next update: ${nextMonday.toISOString()}`);

    setTimeout(() => {
        runWeeklyUpdate();
        setInterval(runWeeklyUpdate, oneWeek);
    }, msUntilMonday);
}

module.exports = { startCron, runWeeklyUpdate };
