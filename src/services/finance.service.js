/**
 * finance.service.js — Mali Komuta Merkezi
 *
 * Tüm AI harcamalarını ve Etsy gelirini takip eder.
 * FinancialTransaction tablosuna raw SQL ile yazar (Prisma generate bağımsız).
 *
 * Exports:
 *   recordExpense(workspaceId, { imageId?, jobId?, amount, provider, description })
 *   recordIncome(workspaceId, { amount, description })
 *   getFinancialSummary(workspaceId)  → { netProfit, burnRate24h, totalIncome, totalExpenses, byProvider, topROI }
 *   estimateAnthropicCost(inputTokens, outputTokens, model)
 */

const { v4: uuidv4 }   = require('uuid');

const prisma = require('../lib/prisma');

// ─── AI Fiyat Tablosu (1M token başına USD) ──────────────────────────────────
const CLAUDE_PRICING = {
    'claude-haiku-4-5-20251001': { input: 0.80,  output: 4.00  },
    'claude-sonnet-4-6':         { input: 3.00,  output: 15.00 },
    'claude-opus-4-7':           { input: 15.00, output: 75.00 },
};
const DEFAULT_CLAUDE = { input: 0.80, output: 4.00 }; // Haiku

// ─── Helpers ──────────────────────────────────────────────────────────────────

function estimateAnthropicCost(inputTokens = 0, outputTokens = 0, model = '') {
    const pricing = CLAUDE_PRICING[model] || DEFAULT_CLAUDE;
    return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

// ─── Writers ──────────────────────────────────────────────────────────────────

async function recordExpense(workspaceId, { imageId = null, jobId = null, amount, provider, description }) {
    if (!workspaceId || !amount || amount <= 0) return;
    try {
        const id = uuidv4();
        await prisma.$executeRawUnsafe(
            `INSERT INTO "FinancialTransaction" (id, "workspaceId", "imageId", "jobId", type, amount, provider, description, "createdAt")
             VALUES ($1, $2, $3, $4, 'EXPENSE', $5, $6, $7, NOW())`,
            id, workspaceId, imageId, jobId, amount, provider, description
        );
    } catch (err) {
        console.warn('[Finance] recordExpense hatası:', err.message);
    }
}

async function recordIncome(workspaceId, { amount, description, imageId = null }) {
    if (!workspaceId || !amount || amount <= 0) return;
    try {
        const id = uuidv4();
        await prisma.$executeRawUnsafe(
            `INSERT INTO "FinancialTransaction" (id, "workspaceId", "imageId", "jobId", type, amount, provider, description, "createdAt")
             VALUES ($1, $2, $3, NULL, 'INCOME', $4, 'etsy', $5, NOW())`,
            id, workspaceId, imageId, amount, description
        );
    } catch (err) {
        console.warn('[Finance] recordIncome hatası:', err.message);
    }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

async function getFinancialSummary(workspaceId) {
    try {
        const [totals, burn24h, byProvider, aiHistory] = await Promise.all([
            // Tüm zamanların gelir / gider toplamı
            prisma.$queryRawUnsafe(`
                SELECT
                    COALESCE(SUM(CASE WHEN type = 'INCOME'  THEN amount ELSE 0 END), 0) AS "totalIncome",
                    COALESCE(SUM(CASE WHEN type = 'EXPENSE' THEN amount ELSE 0 END), 0) AS "totalExpenses"
                FROM "FinancialTransaction"
                WHERE "workspaceId" = $1
            `, workspaceId),

            // Son 24 saatin AI burn rate
            prisma.$queryRawUnsafe(`
                SELECT COALESCE(SUM(amount), 0) AS "burn24h"
                FROM "FinancialTransaction"
                WHERE "workspaceId" = $1
                  AND type = 'EXPENSE'
                  AND "createdAt" >= NOW() - INTERVAL '24 hours'
            `, workspaceId),

            // Provider bazında gider dökümü
            prisma.$queryRawUnsafe(`
                SELECT provider, COALESCE(SUM(amount), 0) AS total
                FROM "FinancialTransaction"
                WHERE "workspaceId" = $1 AND type = 'EXPENSE'
                GROUP BY provider
                ORDER BY total DESC
            `, workspaceId),

            // Son 7 günün günlük AI harcaması (grafik için)
            prisma.$queryRawUnsafe(`
                SELECT
                    DATE("createdAt") AS day,
                    COALESCE(SUM(CASE WHEN type = 'EXPENSE' THEN amount ELSE 0 END), 0) AS expense,
                    COALESCE(SUM(CASE WHEN type = 'INCOME'  THEN amount ELSE 0 END), 0) AS income
                FROM "FinancialTransaction"
                WHERE "workspaceId" = $1
                  AND "createdAt" >= NOW() - INTERVAL '7 days'
                GROUP BY DATE("createdAt")
                ORDER BY day ASC
            `, workspaceId),
        ]);

        const totalIncome   = parseFloat(totals[0]?.totalIncome   ?? 0);
        const totalExpenses = parseFloat(totals[0]?.totalExpenses ?? 0);
        const netProfit     = totalIncome - totalExpenses;
        const burnRate24h   = parseFloat(burn24h[0]?.burn24h ?? 0);

        // ROI hesabı: ortalama gelir / ortalama gider (görsel başına)
        // Görsel başına fiyat: DEFAULT_LISTING_PRICE env veya 19.99
        const listingPrice = parseFloat(process.env.DEFAULT_LISTING_PRICE || '19.99');
        const approvedCount = await prisma.image.count({
            where: { job: { workspaceId }, isApproved: true },
        });
        const avgCostPerImage = approvedCount > 0 ? totalExpenses / approvedCount : 0;
        const roiMultiple     = avgCostPerImage > 0 ? listingPrice / avgCostPerImage : null;

        return {
            totalIncome:    +totalIncome.toFixed(4),
            totalExpenses:  +totalExpenses.toFixed(4),
            netProfit:      +netProfit.toFixed(4),
            burnRate24h:    +burnRate24h.toFixed(4),
            byProvider:     byProvider.map(r => ({ provider: r.provider, total: parseFloat(r.total) })),
            aiHistory:      aiHistory.map(r => ({
                day:     r.day,
                expense: parseFloat(r.expense),
                income:  parseFloat(r.income),
            })),
            // ROI Predictor
            roi: {
                avgCostPerImage:  +avgCostPerImage.toFixed(4),
                listingPrice,
                roiMultiple:      roiMultiple ? +roiMultiple.toFixed(1) : null,
                approvedCount,
            },
        };
    } catch (err) {
        console.warn('[Finance] getFinancialSummary hatası:', err.message);
        return {
            totalIncome: 0, totalExpenses: 0, netProfit: 0,
            burnRate24h: 0, byProvider: [], aiHistory: [],
            roi: { avgCostPerImage: 0, listingPrice: 19.99, roiMultiple: null, approvedCount: 0 },
        };
    }
}

module.exports = { recordExpense, recordIncome, getFinancialSummary, estimateAnthropicCost };
