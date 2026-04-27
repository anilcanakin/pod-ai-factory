/**
 * Brainstorm Service — AI-Powered Product Idea Generator
 *
 * CorporateMemory tablosundaki tüm aktif kuralları (STRATEGY, RULES, SEO_TACTICS, vb.)
 * okur ve Claude'a göndererek 3 adet yüksek potansiyelli, uygulanabilir ürün fikri
 * ("Action Card") üretir.
 *
 * Her Action Card:
 *   - title          → Kısa ve çarpıcı ürün adı
 *   - niche          → Hedef niş (ör: "Patriotic Dad Gifts")
 *   - productType    → T-shirt / Sweatshirt / Mug / Sticker / Poster
 *   - designBrief    → 2-3 cümle görsel tarifi (AI image prompt'a dönüştürülebilir)
 *   - targetAudience → Kim alacak?
 *   - keyTags        → ["tag1","tag2","tag3","tag4","tag5"]
 *   - estimatedScore → 1-100 arası potansiyel skoru
 *   - reasoning      → Neden bu fikir iyi? Hangi kurala dayalı?
 *   - basedOnRules   → Hangi Brain kurallarından türetildi (ID + kısa başlık)
 *
 * Kullanım:
 *   const { brainstorm } = require('./brainstorm.service');
 *   const ideas = await brainstorm('workspace-id');
 */

const anthropic    = require('../lib/anthropic');

const prisma = require('../lib/prisma');

const MODEL    = 'claude-haiku-4-5-20251001';
const MAX_RULES = 40;   // prompt'a enjekte edilecek max kural sayısı
const MAX_CHARS = 6000; // toplam kural metni limiti

// Kategori öncelik sırası — strateji ve kurallar önce gelir
const CATEGORY_PRIORITY = ['STRATEGY', 'RULES', 'SEO_TACTICS', 'SEO', 'VISUAL', 'MANAGEMENT'];

/**
 * CorporateMemory'den aktif kuralları çek.
 * Önce yüksek öncelikli kategorileri, sonra tarihe göre sıralar.
 */
async function _fetchRules(workspaceId) {
    const all = await prisma.corporateMemory.findMany({
        where: {
            workspaceId,
            isActive: true,
        },
        orderBy: { createdAt: 'desc' },
        select: {
            id:             true,
            title:          true,
            content:        true,
            category:       true,
            type:           true,
            tags:           true,
            analysisResult: true,
            createdAt:      true,
        },
        take: 200, // DB'den max 200 çek, sonra filtreleyeceğiz
    });

    // Kategori önceliğine göre sırala
    const sorted = all.sort((a, b) => {
        const ai = CATEGORY_PRIORITY.indexOf(a.category);
        const bi = CATEGORY_PRIORITY.indexOf(b.category);
        const pa = ai >= 0 ? ai : CATEGORY_PRIORITY.length;
        const pb = bi >= 0 ? bi : CATEGORY_PRIORITY.length;
        if (pa !== pb) return pa - pb;
        return new Date(b.createdAt) - new Date(a.createdAt);
    });

    return sorted.slice(0, MAX_RULES);
}

/**
 * Kuralları AI prompt'a enjekte edilecek formata dönüştür.
 */
function _formatRulesBlock(rules) {
    let totalChars = 0;
    const lines = [];

    for (const r of rules) {
        // Kural metnini oluştur: başlık + içerik özeti
        const ar = r.analysisResult || {};
        const displayTitle = ar.displayTitle || r.title.replace(/^\[YouTube\]\s*/i, '').slice(0, 60);

        // actionableRules varsa onları kullan, yoksa content'in ilk 200 karakterini
        let ruleText = '';
        if (ar.actionableRules?.length) {
            ruleText = ar.actionableRules
                .map(rule => `IF ${rule.condition} THEN ${rule.action}`)
                .join('; ');
        } else if (ar.synthesis) {
            ruleText = ar.synthesis.slice(0, 200);
        } else {
            ruleText = r.content.slice(0, 200).replace(/\n+/g, ' ');
        }

        const line = `[${r.category || 'GENERAL'}] "${displayTitle}" → ${ruleText}`;

        if (totalChars + line.length > MAX_CHARS) break;
        totalChars += line.length + 1;
        lines.push({ line, id: r.id, title: displayTitle });
    }

    return lines;
}

/**
 * Ana brainstorm fonksiyonu.
 *
 * @param {string}  workspaceId
 * @param {object}  options
 * @param {number}  options.count      — Üretilecek fikir sayısı (default 3)
 * @param {string}  options.focusNiche — Belirli bir niş'e odaklan (opsiyonel)
 * @param {string}  options.season     — Mevsimsel odak (opsiyonel: "summer", "christmas", vb.)
 * @returns {Promise<{ ideas: ActionCard[], rulesUsed: number, generatedAt: string }>}
 */
async function brainstorm(workspaceId, { count = 3, focusNiche = '', season = '', excludeNiches = [] } = {}) {
    console.log(`[Brainstorm] 🧠 Başlatılıyor — workspace: ${workspaceId}`);

    // 1. Kuralları çek
    const rules = await _fetchRules(workspaceId);
    if (rules.length === 0) {
        console.warn('[Brainstorm] CorporateMemory boş — varsayılan öneriler kullanılıyor.');
    }

    const formattedRules = _formatRulesBlock(rules);
    const rulesBlock = formattedRules.map(r => r.line).join('\n');

    // 2. Tarih ve mevsimsel bağlam
    const now = new Date();
    const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
                        'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
    const dateContext = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;

    // 2.5 Exclude List (Son üretilen 15 fikir)
    const recentIdeas = await prisma.corporateMemory.findMany({
        where: { workspaceId, type: 'ACTION_CARD' },
        orderBy: { createdAt: 'desc' },
        take: 15,
        select: { title: true }
    });
    const excludeList = recentIdeas.map(r => r.title).join('\n- ');
    const excludeBlock = excludeList ? `\n\n## EXCLUDE LIST (Aşağıdaki fikirleri TEKRAR ETME):\n- ${excludeList}` : '';

    // 3. Prompt oluştur
    const focusLine = focusNiche ? `\n🎯 ODAK NİŞ: ${focusNiche} — bu niş etrafında fikirler üret.` : '';
    const seasonLine = season ? `\n🌡️ MEVSİM: ${season} — mevsimsel talep avantajlarını düşün.` : '';
    const negativeBlock = excludeNiches.length > 0
        ? `\n\n## DÜŞÜK PERFORMANSI KANILTI NİŞLER (Bu niş/ürünlere YAKLAŞMA):\n${excludeNiches.map(n => `- ${n}`).join('\n')}`
        : '';

    const prompt = `Sen bir Etsy Print-on-Demand (POD) ürün stratejisti AI'sın.
Tarih: ${dateContext}
${focusLine}${seasonLine}${excludeBlock}${negativeBlock}

## SENİN BİLGİ TABANIN (Brain Academy Kuralları):
${rulesBlock || '(Henüz kural eklenmemiş — genel POD en iyi uygulamaları ile devam et.)'}

## GÖREV:
Yukarıdaki kurallara dayanarak TAM ${count} adet yüksek potansiyelli, hemen uygulanabilir
Etsy POD ürün fikri ("Action Card") üret.

Her fikir:
- Brain'deki en az 1-2 kurala DOĞRUDAN bağlı olmalı
- Rakiplerden farklılaşmalı (benzersiz açı veya hook içermeli)
- Net bir hedef kitle belirtmeli
- Somut bir tasarım tasviri içermeli (prompt haline dönüştürülebilir)
- 5 adet Etsy-optimize tag önerisi içermeli

SADECE aşağıdaki JSON formatında yanıt ver, başka hiçbir şey yazma:
{
  "ideas": [
    {
      "title": "Kısa ve çarpıcı ürün adı",
      "niche": "Hedef niş (ör: Patriotic Dad Gifts)",
      "productType": "T-shirt | Sweatshirt | Mug | Sticker | Poster",
      "designBrief": "2-3 cümle: Tasarımda ne olacak? Renk paleti? Tipografi stili?",
      "targetAudience": "Kim alacak? Yaş aralığı, ilgi alanı, hediye mi self-purchase mı?",
      "keyTags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
      "estimatedScore": 85,
      "reasoning": "Bu fikir neden iyi? Hangi kurala dayanıyor? Pazar fırsatı ne?",
      "basedOnRuleIds": ["kural_id_1", "kural_id_2"]
    }
  ]
}`;

    // 4. Claude çağrısı
    console.log(`[Brainstorm] ${formattedRules.length} kural enjekte edildi, Claude'a gönderiliyor...`);

    let ideas = [];
    try {
        const response = await anthropic.messages.create({
            model:      MODEL,
            max_tokens: 2500,
            messages:   [{ role: 'user', content: prompt }],
        });

        const raw = response.content[0].text
            .trim()
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();

        const parsed = JSON.parse(raw);
        ideas = parsed.ideas || [];

        const ruleMap = new Map(formattedRules.map(r => [r.id, r.title]));
        for (const idea of ideas) {
            idea.basedOnRules = (idea.basedOnRuleIds || [])
                .map(id => ({ id, title: ruleMap.get(id) || 'Unknown Rule' }))
                .filter(r => r.title !== 'Unknown Rule');
            delete idea.basedOnRuleIds;

            // Save to CorporateMemory
            const dbCard = await prisma.corporateMemory.create({
                data: {
                    workspaceId,
                    title: idea.title,
                    content: `Niche: ${idea.niche}\nProduct: ${idea.productType}\nBrief: ${idea.designBrief}`,
                    category: 'brainstorm',
                    type: 'ACTION_CARD',
                    analysisResult: {
                        ...idea,
                        is_brainstorm_result: true,
                        status: 'PENDING_REVIEW'
                    }
                }
            });
            idea.id = dbCard.id; // inject DB ID
        }

        console.log(`[Brainstorm] ✅ ${ideas.length} Action Card üretildi ve kaydedildi.`);

    } catch (err) {
        console.error('[Brainstorm] Claude hatası:', err.message);
        throw new Error('Brainstorm AI yanıtı alınamadı: ' + err.message);
    }

    return {
        ideas,
        rulesUsed:   formattedRules.length,
        totalRules:  rules.length,
        generatedAt: new Date().toISOString(),
    };
}

/**
 * Mevcut bir Action Card'ı güncel kurallara göre yeniden puanla ve güncelle.
 */
async function updateIdea(id, workspaceId) {
    const memory = await prisma.corporateMemory.findUnique({
        where: { id }
    });

    if (!memory || memory.workspaceId !== workspaceId) {
        throw new Error('Fikir bulunamadı veya yetkisiz erişim');
    }

    const rules = await _fetchRules(workspaceId);
    const formattedRules = _formatRulesBlock(rules);
    const rulesBlock = formattedRules.map(r => r.line).join('\n');

    const prompt = `Sen bir Etsy Print-on-Demand (POD) ürün stratejisti AI'sın.
Aşağıda veritabanından çekilmiş eski bir ürün fikri (Action Card) var.
Lütfen EN GÜNCEL KURAL TABANIMIZI (Brain Academy Kuralları) kullanarak bu fikri YENİDEN DEĞERLENDİR.

## GÜNCEL KURAL TABANI:
${rulesBlock || '(Henüz kural eklenmemiş)'}

## ESKİ FİKİR BİLGİLERİ:
Başlık: ${memory.title}
Niş: ${memory.analysisResult?.niche}
Ürün: ${memory.analysisResult?.productType}
Brief: ${memory.analysisResult?.designBrief}
Hedef Kitle: ${memory.analysisResult?.targetAudience}

## GÖREV:
Bu fikrin güncel kurallara göre potansiyel skorunu (1-100) ve Nedenini (Reasoning) TEKRAR HESAPLA.
SADECE aşağıdaki JSON formatında yanıt ver:
{
  "estimatedScore": 88,
  "reasoning": "Yeni stratejiler doğrultusunda bu fikrin pazar uyumu..."
}`;

    const response = await anthropic.messages.create({
        model:      MODEL,
        max_tokens: 500,
        messages:   [{ role: 'user', content: prompt }],
    });

    const raw = response.content[0].text.trim().replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(raw);

    const updatedAnalysisResult = {
        ...(memory.analysisResult || {}),
        estimatedScore: parsed.estimatedScore,
        reasoning: parsed.reasoning,
        lastUpdatedViaAI: new Date().toISOString()
    };

    await prisma.corporateMemory.update({
        where: { id },
        data: { analysisResult: updatedAnalysisResult }
    });

    return updatedAnalysisResult;
}

module.exports = { brainstorm, updateIdea };
