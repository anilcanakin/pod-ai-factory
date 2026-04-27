/**
 * AI Brain Discovery Score Service
 *
 * Yeni keşfedilen bir nişi, CorporateMemory'deki mevcut stratejik kurallara
 * göre değerlendirir ve 0-100 arası bir "Discovery Score" hesaplar.
 * Bu servis Autonomous Radar Worker tarafından kullanılır.
 */

const anthropic = require('../lib/anthropic');

const prisma = require('../lib/prisma');
const MODEL  = 'claude-haiku-4-5-20251001';
const MAX_RULES = 30;
const CATEGORY_PRIORITY = ['STRATEGY', 'RULES', 'SEO_TACTICS', 'SEO', 'VISUAL', 'MANAGEMENT'];

async function _fetchBrainRules(workspaceId) {
    const all = await prisma.corporateMemory.findMany({
        where: {
            workspaceId,
            isActive: true,
            type: { notIn: ['WPI_SNAPSHOT', 'WPI_WINNER', 'HOT_DISCOVERY', 'ACTION_CARD'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, title: true, content: true, category: true, analysisResult: true },
    });

    return all
        .sort((a, b) => {
            const ai = CATEGORY_PRIORITY.indexOf(a.category);
            const bi = CATEGORY_PRIORITY.indexOf(b.category);
            const pa = ai >= 0 ? ai : CATEGORY_PRIORITY.length;
            const pb = bi >= 0 ? bi : CATEGORY_PRIORITY.length;
            return pa - pb;
        })
        .slice(0, MAX_RULES);
}

function _formatRulesBlock(rules) {
    return rules.map(r => {
        const ar = r.analysisResult || {};
        const title = ar.displayTitle || r.title.replace(/^\[YouTube\]\s*/i, '').slice(0, 60);
        let ruleText = '';
        if (ar.actionableRules?.length) {
            ruleText = ar.actionableRules.map(rule => `IF ${rule.condition} THEN ${rule.action}`).join('; ');
        } else if (ar.synthesis) {
            ruleText = ar.synthesis.slice(0, 200);
        } else {
            ruleText = r.content.slice(0, 200).replace(/\n+/g, ' ');
        }
        return `[${r.category || 'GENERAL'}] "${title}" → ${ruleText}`;
    }).join('\n');
}

/**
 * Score a discovered niche against the Brain's strategic rules.
 *
 * @param {string} workspaceId
 * @param {string} niche          — The discovered niche/keyword to evaluate
 * @param {object} opts
 * @param {string} opts.source    — 'etsy' | 'google_trends' | 'pinterest'
 * @param {string[]} opts.relatedKeywords
 * @returns {Promise<{ score, reasoning, keywords, urgency, productRecommendation }>}
 */
async function scoreDiscovery(workspaceId, niche, { source = 'etsy', relatedKeywords = [] } = {}) {
    const rules = await _fetchBrainRules(workspaceId);
    const rulesBlock = rules.length > 0
        ? _formatRulesBlock(rules)
        : '(Henüz kural eklenmemiş — genel POD en iyi uygulamaları kullanılıyor)';

    const now = new Date();
    const monthName = now.toLocaleString('en-US', { month: 'long' });

    const prompt = `Sen bir Etsy Print-on-Demand (POD) pazar istihbarat uzmanısın.
Tarih: ${monthName} ${now.getFullYear()} | Veri Kaynağı: ${source.toUpperCase()}

## BRAIN KNOWLEDGE BASE (Stratejik Kurallar):
${rulesBlock}

## ANALİZ EDILECEK NİŞ:
"${niche}"
İlgili anahtar kelimeler: ${relatedKeywords.slice(0, 5).join(', ') || 'yok'}

## GÖREV:
Bu niş için bir "Discovery Score" (0-100) hesapla.

Scoring kriterleri:
- Seasonal/Event relevance (${monthName} ${now.getFullYear()} baz alınarak): 0-25 puan
- Brain kurallarıyla uyum (en az 1 kurala dayalı iseniz +bonus): 0-35 puan
- Pazar fırsatı (low competition + high demand sinyali): 0-25 puan
- Şu an harekete geçilmesi gereken aciliyet (timing): 0-15 puan

SADECE aşağıdaki JSON formatında yanıt ver, başka hiçbir şey yazma:
{
  "score": 82,
  "reasoning": "Bu niche şu an peak sezon yaklaşımı nedeniyle...",
  "suggestedKeywords": ["kw1", "kw2", "kw3"],
  "urgency": "high",
  "productRecommendation": "T-Shirt veya Hoodie"
}`;

    try {
        const response = await anthropic.messages.create({
            model: MODEL,
            max_tokens: 600,
            messages: [{ role: 'user', content: prompt }],
        });

        const raw = response.content[0].text
            .trim()
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();
        const parsed = JSON.parse(raw);

        return {
            score:                 Math.min(100, Math.max(0, parseInt(parsed.score, 10) || 0)),
            reasoning:             parsed.reasoning || '',
            keywords:              Array.isArray(parsed.suggestedKeywords) ? parsed.suggestedKeywords : relatedKeywords,
            urgency:               parsed.urgency || 'medium',
            productRecommendation: parsed.productRecommendation || '',
        };
    } catch (err) {
        console.error('[AIBrain] scoreDiscovery failed:', err.message);
        return { score: 0, reasoning: 'Analysis failed', keywords: relatedKeywords, urgency: 'low', productRecommendation: '' };
    }
}

// ─── evaluateNiche ────────────────────────────────────────────────────────────

const MIN_HOT_SCORE = 75;

/**
 * Bir nişi değerlendirir: puan < 75 → null döner (atla).
 * Puan ≥ 75 → CorporateMemory'e HOT_DISCOVERY kaydeder ve sonucu döner.
 * Radar worker bu fonksiyonu her trend için çağırır.
 *
 * @param {string} workspaceId
 * @param {string} niche
 * @param {{ source?: string, relatedKeywords?: string[] }} opts
 * @returns {Promise<{ id, discoveryScore, niche, reasoning, keywords, urgency, productRecommendation, isCritical } | null>}
 */
async function evaluateNiche(workspaceId, niche, { source = 'etsy', relatedKeywords = [] } = {}) {
    const result = await scoreDiscovery(workspaceId, niche, { source, relatedKeywords });

    if (result.score < MIN_HOT_SCORE) return null;

    const isCritical = result.score >= 90;

    const entry = await prisma.corporateMemory.create({
        data: {
            workspaceId,
            type:     'HOT_DISCOVERY',
            title:    `[Radar] ${niche.slice(0, 120)}`,
            content:  `${source.toUpperCase()} kaynaklı | Score: ${result.score} | ${result.reasoning.slice(0, 300)}`,
            category: 'STRATEGY',
            tags:     result.keywords,
            isActive: true,
            analysisResult: {
                niche,
                discoveryScore:        result.score,
                reasoning:             result.reasoning,
                suggestedKeywords:     result.keywords,
                productRecommendation: result.productRecommendation,
                urgency:               result.urgency,
                source,
                discoveredAt:          new Date().toISOString(),
                isCritical,
            },
        },
    });

    return {
        id:                    entry.id,
        discoveryScore:        result.score,
        niche,
        reasoning:             result.reasoning,
        keywords:              result.keywords,
        urgency:               result.urgency,
        productRecommendation: result.productRecommendation,
        isCritical,
    };
}

module.exports = { scoreDiscovery, evaluateNiche };
