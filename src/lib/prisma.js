/**
 * Prisma Client Singleton
 *
 * Tüm servisler ve route'lar bu modülden import eder — her yerde ayrı
 * `new PrismaClient()` çağrısı yok. Node.js require cache sayesinde
 * süreç boyunca tek bağlantı havuzu kullanılır.
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
});

module.exports = prisma;
