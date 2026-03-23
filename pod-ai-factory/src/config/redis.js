const Redis = require('ioredis');

const redisConfig = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null, // Required by BullMQ
};

const connection = new Redis(redisConfig);

connection.on('error', (err) => {
    console.error('Redis connection error:', err);
});

module.exports = connection;
