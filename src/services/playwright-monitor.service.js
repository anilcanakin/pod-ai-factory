const redis = require('../config/redis');

const PUBLISH_KEY     = 'playwright:lastPublishAt';
const COOLDOWN_KEY    = 'playwright:alertSentAt';
const ALERT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 saat yayın yoksa uyar
const COOLDOWN_MS     =  6 * 60 * 60 * 1000; // aynı uyarıyı 6h içinde tekrarlama

async function sendAlert(message, metadata = {}) {
    const token  = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (token && chatId) {
        try {
            const fetch = require('node-fetch');
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: `🚨 <b>POD AI Factory</b>\n\n${message}`,
                    parse_mode: 'HTML',
                }),
            });
        } catch (err) {
            console.error('[Monitor] Telegram alert hatası:', err.message);
        }
    }

    console.error(`[Monitor] ALERT: ${message}`);

    if (metadata.workspaceId) {
        try {
            const { logNotification } = require('../routes/notification.routes');
            logNotification(metadata.workspaceId, 'critical', message, metadata);
        } catch (_) {}
    }
}

async function recordPublishSuccess() {
    try {
        await redis.set(PUBLISH_KEY, Date.now().toString());
    } catch (err) {
        console.warn('[Monitor] recordPublishSuccess başarısız:', err.message);
    }
}

async function checkPublishHealth(workspaceId) {
    try {
        const [tsStr, cooldownStr] = await Promise.all([
            redis.get(PUBLISH_KEY),
            redis.get(COOLDOWN_KEY),
        ]);

        if (!tsStr) return; // henüz hiç yayın yapılmamış — baseline yok

        const elapsed = Date.now() - parseInt(tsStr, 10);
        if (elapsed <= ALERT_WINDOW_MS) return; // 24h geçmemiş — sağlıklı

        // Aynı uyarıyı 6h içinde tekrar gönderme
        if (cooldownStr && (Date.now() - parseInt(cooldownStr, 10)) < COOLDOWN_MS) return;

        const hours  = Math.round(elapsed / 3_600_000);
        const lastAt = new Date(parseInt(tsStr, 10)).toLocaleString('tr-TR');

        await sendAlert(
            `⚠️ Son <b>${hours} saattir</b> hiçbir Etsy ilanı yayınlanmadı.\n\n` +
            `Son başarılı yayın: <b>${lastAt}</b>\n\n` +
            `Playwright oturumunu veya yayınlama pipeline'ını kontrol et.`,
            { workspaceId, type: 'playwright_health', lastPublishAt: lastAt }
        );

        await redis.set(COOLDOWN_KEY, Date.now().toString());
    } catch (err) {
        console.warn('[Monitor] checkPublishHealth başarısız:', err.message);
    }
}

module.exports = { sendAlert, recordPublishSuccess, checkPublishHealth };
