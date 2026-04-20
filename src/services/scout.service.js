/**
 * Niche Scout Service
 *
 * Google Trends RSS + Apify Pinterest verilerini çekerek Claude Haiku'ya
 * "Bu trendlerden Etsy'de rekabeti düşük ama talebi yüksek 5 micro-niche üret"
 * sorusunu sorar. Sonuçlar CorporateMemory'ye kaydedilir ve WPI taramasına
 * doğrudan beslenebilir.
 */

const fetch       = require('node-fetch');
const anthropic   = require('../lib/anthropic');
const { PrismaClient } = require('@prisma/client');
const { _suggestNiches } = require('./wpi.service');
const { getContextForAI } = require('./knowledge.service');

const prisma = new PrismaClient();

// Google Trends Daily RSS (US) — ücretsiz, auth yok
const GOOGLE_TRENDS_RSS = 'https://trends.google.com/trends/trendingsearches/daily/rss?geo=US';

// ─── Google Trends RSS fetcher ────────────────────────────────────────────────

async function _fetchGoogleTrends() {
    try {
        const res  = await fetch(GOOGLE_TRENDS_RSS, { timeout: 10000 });
        if (!res.ok) throw new Error(`Google Trends RSS HTTP ${res.status}`);
        const xml  = await res.text();

        // CDATA içindeki title'ları yakala
        const matches = [...xml.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>/g)];
        const trends  = matches
            .map(m => m[1].trim())
            .filter(t => t.length > 2 && !t.toLowerCase().includes('google trends')); // başlık satırını atla

        console.log(`[Scout] Google Trends: ${trends.length} trend yakalandı.`);
        return trends.slice(0, 25);
    } catch (err) {
        console.warn('[Scout] Google Trends RSS hatası:', err.message);
        return [];
    }
}

// ─── DB: CorporateMemory kayıt ────────────────────────────────────────────────

async function _saveSuggestions(workspaceId, niches, source = 'google_trends') {
    const saved = [];
    for (const niche of niches) {
        try {
            const record = await prisma.corporateMemory.create({
                data: {
                    workspaceId,
                    type:     'WPI_SCOUT',
                    title:    `[SCOUT] ${niche.niche}`,
                    content:  niche.reasoning,
                    category: 'STRATEGY',
                    isActive: true,
                    tags:     ['scout', 'micro-niche', source],
                    analysisResult: {
                        scanType:   'NICHE_SCOUT',
                        niche:      niche.niche,
                        keyword:    niche.keyword,
                        reasoning:  niche.reasoning,
                        confidence: niche.confidence,
                        source,
                        scoutedAt:  new Date().toISOString(),
                    },
                },
            });
            saved.push({ ...niche, id: record.id, createdAt: record.createdAt });
        } catch (err) {
            console.warn('[Scout] DB kayıt hatası:', err.message);
        }
    }
    return saved;
}

// ─── Suggestions list ─────────────────────────────────────────────────────────

async function listSuggestions(workspaceId, limit = 30) {
    const records = await prisma.corporateMemory.findMany({
        where: { workspaceId, type: 'WPI_SCOUT', isActive: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
    });

    return records.map(r => ({
        id:         r.id,
        niche:      r.analysisResult?.niche      ?? r.title.replace('[SCOUT] ', ''),
        keyword:    r.analysisResult?.keyword    ?? '',
        reasoning:  r.analysisResult?.reasoning  ?? r.content,
        confidence: r.analysisResult?.confidence ?? 0,
        source:     r.analysisResult?.source     ?? 'unknown',
        createdAt:  r.createdAt,
    }));
}

// ─── Main: runScout ───────────────────────────────────────────────────────────

/**
 * Tam Scout döngüsü:
 *   1. Google Trends RSS çek
 *   2. (İleride) Pinterest pinlerini çek
 *   3. Claude Haiku → 5 micro-niche üret
 *   4. CorporateMemory'ye kaydet
 *   5. Sonuçları döndür
 */
async function runScout(workspaceId) {
    console.log('[Scout] 🔭 Niche Scout başladı...');

    // 1. Trend kaynakları
    const googleTrends = await _fetchGoogleTrends();

    // TODO: Pinterest trends entegrasyonu — scout.service.js#_fetchPinterestTrends()
    // const pinterestTrends = await _fetchPinterestTrends(workspaceId);
    const allTrends = [...googleTrends]; // + pinterestTrends sonrası buraya eklenecek

    if (!allTrends.length) {
        console.warn('[Scout] Hiçbir trend verisi alınamadı — default 2026 trendleri kullanılıyor.');
        allTrends.push('4th of July 2026', 'FIFA World Cup 2026', 'Mother Day gifts', 'minimalist wall art', 'back to school teacher');
    }

    // 2. Academy context — kullanıcının strateji/kural/SEO kurallarını enjekte et
    const academyContext = await getContextForAI(workspaceId, 'etsy niche strategy rules seo tactics', { maxChars: 500, topK: 4 });

    // 3. Claude Haiku → micro-niche önerileri
    const niches = await _suggestNiches(allTrends, workspaceId, academyContext);
    console.log(`[Scout] ${niches.length} micro-niche üretildi.`);

    // 4. DB'ye kaydet
    const saved = await _saveSuggestions(workspaceId, niches, 'google_trends');

    return {
        suggestions:  saved,
        trendsUsed:   allTrends.length,
        scoutedAt:    new Date().toISOString(),
    };
}

module.exports = { runScout, listSuggestions };
