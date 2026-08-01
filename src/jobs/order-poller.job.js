const fulfillment = require('../services/fulfillment.service');

const INTERVAL_MS = 30 * 60 * 1000; // 30 dakika

async function runCheck() {
    try {
        const newOrders = await fulfillment.checkNewOrders('default-workspace');
        if (newOrders.length) {
            console.log(`[OrderPoller] ${newOrders.length} yeni sipariş işlendi.`);
        } else {
            console.log('[OrderPoller] Yeni sipariş yok.');
        }
    } catch (err) {
        console.error('[OrderPoller] Hata:', err.message);
    }
}

function startCron() {
    if (process.env.STAGING_MODE === 'true') {
        console.log('[OrderPoller] STAGING_MODE aktif — gerçek Etsy hesabına dokunmamak için cron devre dışı.');
        return;
    }
    console.log('[OrderPoller] Başlatıldı — 30 dakikada bir Etsy sipariş kontrolü aktif.');
    setInterval(runCheck, INTERVAL_MS);
}

module.exports = { startCron, runCheck };
