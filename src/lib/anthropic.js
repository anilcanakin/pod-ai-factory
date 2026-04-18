/**
 * Anthropic Client Singleton
 *
 * Tüm servisler bu modülden import eder — her serviste ayrı `new Anthropic()` yok.
 * - Bağlantı havuzu tek noktadan yönetilir
 * - API key değişikliği tek yerden yapılır
 * - Test/mock edilmesi kolaylaşır
 */

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = client;
