const rateLimit = require('express-rate-limit');

const handler = (req, res) => {
    res.status(429).json({
        error: 'Çok fazla istek gönderildi. Lütfen bekleyin.',
        retryAfter: res.getHeader('Retry-After'),
    });
};

// Auth: brute-force koruması — 5 dakikada 15 deneme
const authLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    handler,
});

// Ağır AI/FAL operasyonları — dakikada 60 istek (saniyede 1)
// Factory analyze, generate, tools (BG/upscale/vector), vision, pipeline
const aiHeavyLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    handler,
});

// İçerik üretimi — dakikada 40 istek
// SEO, ideas, batch, WPI, scout, brain
const aiContentLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    handler,
});

// Genel API — dakikada 300 istek (döngü/bug koruması)
const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    handler,
});

module.exports = { authLimiter, aiHeavyLimiter, aiContentLimiter, generalLimiter };
