const Redis = require('ioredis');

// REDIS_URL (Upstash veya herhangi bir managed Redis) varsa onu kullan,
// yoksa localhost'a düş. Upstash rediss:// (TLS) URL'lerini ioredis
// otomatik olarak tanır; tls seçeneğini ayrıca geçirmemize gerek yok.
const connection = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
    : new Redis({
          host: process.env.REDIS_HOST || '127.0.0.1',
          port: Number(process.env.REDIS_PORT) || 6379,
          maxRetriesPerRequest: null,
      });

connection.on('connect', () => {
    const target = process.env.REDIS_URL
        ? process.env.REDIS_URL.replace(/:\/\/[^@]+@/, '://<credentials>@')
        : `${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`;
    console.log(`[Redis] Bağlandı → ${target}`);
});

connection.on('error', (err) => {
    console.error('[Redis] Bağlantı hatası:', err.message);
});

module.exports = connection;
