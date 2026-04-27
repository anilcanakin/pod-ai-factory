const Redis = require('ioredis');

// Bağlantı önceliği:
//   1. NODE_ENV=development + LOCAL_REDIS_URL → yerel Redis (dev)
//   2. REDIS_URL                              → Upstash / prod Redis
//   3. REDIS_HOST + REDIS_PORT                → Docker / fallback
const isDev      = process.env.NODE_ENV === 'development';
const localUrl   = process.env.LOCAL_REDIS_URL;
const remoteUrl  = process.env.REDIS_URL;

let _connectTarget;
let connection;

if (isDev && localUrl) {
    // Geliştirme: yerel Redis — Upstash kotasını harcama
    connection     = new Redis(localUrl, { maxRetriesPerRequest: null });
    _connectTarget = localUrl.replace(/:\/\/[^@]+@/, '://<credentials>@');
} else if (remoteUrl) {
    // Prod / Upstash
    connection     = new Redis(remoteUrl, { maxRetriesPerRequest: null });
    _connectTarget = remoteUrl.replace(/:\/\/[^@]+@/, '://<credentials>@');
} else {
    // Docker / manuel host:port
    const host     = process.env.REDIS_HOST || '127.0.0.1';
    const port     = Number(process.env.REDIS_PORT) || 6379;
    connection     = new Redis({ host, port, maxRetriesPerRequest: null });
    _connectTarget = `${host}:${port}`;
}

connection.on('connect', () => {
    const mode = (isDev && localUrl) ? '[DEV-LOCAL]' : (remoteUrl ? '[UPSTASH]' : '[LOCAL]');
    console.log(`[Redis] ✔ Bağlandı ${mode} → ${_connectTarget}`);
});

connection.on('error', (err) => {
    console.error('[Redis] Bağlantı hatası:', err.message);
});

module.exports = connection;
