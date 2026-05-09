 const redis = require('../config/redis');
  const PUBLISH_KEY = 'playwright:lastPublishAt';
  const COOLDOWN_KEY = 'playwright:alertSentAt';
  const ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;
  const COOLDOWN_MS = 6 * 60 * 60 * 1000;

  async function sendAlert(message, metadata = {}) {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (token && chatId) {
          try {
              const fetch = require('node-fetch');
              await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ chat_id: chatId, text: `POD AI Factory\n\n${message}` }),
              });
          } catch (err) { console.error('[Monitor] Telegram hatasi:', err.message); }
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
      try { await redis.set(PUBLISH_KEY, Date.now().toString()); }
      catch (err) { console.warn('[Monitor] kayit basarisiz:', err.message); }
  }

  async function checkPublishHealth(workspaceId) {
      try {
          const [tsStr, cooldownStr] = await Promise.all([redis.get(PUBLISH_KEY), redis.get(COOLDOWN_KEY)]);
          if (!tsStr) return;
          const elapsed = Date.now() - parseInt(tsStr, 10);
          if (elapsed <= ALERT_WINDOW_MS) return;
          if (cooldownStr && (Date.now() - parseInt(cooldownStr, 10)) < COOLDOWN_MS) return;
          const hours = Math.round(elapsed / 3_600_000);
          const lastAt = new Date(parseInt(tsStr, 10)).toLocaleString('tr-TR');
          await sendAlert(`Son ${hours} saattir hicbir Etsy ilani yayinlanmadi. Son basarili yayin: ${lastAt}`, { workspaceId, type: 'playwright_health' });
          await redis.set(COOLDOWN_KEY, Date.now().toString());
      } catch (err) { console.warn('[Monitor] health check basarisiz:', err.message); }
  }

  module.exports = { sendAlert, recordPublishSuccess, checkPublishHealth };
