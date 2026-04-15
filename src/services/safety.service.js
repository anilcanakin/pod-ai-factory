const Anthropic = require('@anthropic-ai/sdk');
const { TRADEMARK_BLACKLIST } = require('../config/blacklist');

const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

class SafetyService {
    /**
     * İki aşamalı Legal Guard kontrolü yapar.
     * @param {Object} seoData { title, description, tags }
     * @returns {Promise<{ isSafe: boolean, reason?: string }>}
     */
    async validateLegalSafety(seoData) {
        if (!seoData) return { isSafe: true };

        const { title = '', description = '', tags = [] } = seoData;
        const fullText = `${title} ${description} ${tags.join(' ')}`.toLowerCase();

        // 1. AŞAMA: Regex (Kara Liste) Taraması
        console.log(`[Legal Guard] Aşama 1: Regex Blacklist Taraması Başladı...`);
        for (const term of TRADEMARK_BLACKLIST) {
            // Tam kelime eşleşmesi için regex (örneğin "applet" geçer ama "apple" geçmez)
            const regex = new RegExp(`\\b${term}\\b`, 'i');
            if (regex.test(fullText)) {
                console.warn(`[Legal Guard] ❌ İhlal Tespit Edildi (Kara Liste): "${term}"`);
                return { isSafe: false, reason: `Kara liste ihlali: "${term}"` };
            }
        }
        console.log(`[Legal Guard] Aşama 1: ✅ Statik taramadan geçti.`);

        // 2. AŞAMA: AI Validation Taraması
        console.log(`[Legal Guard] Aşama 2: AI Trademark Analizi Başladı...`);
        try {
            const prompt = `Aşağıdaki ürün başlığı ve etiketleri herhangi bir global tescilli marka, lisanslı karakter (Disney, Marvel vb.) veya 'trademark' kuralını ihlal ediyor mu?
Cevap formatın KESİNLİKLE sadece "EVET" veya "HAYIR" olmalıdır.

Başlık: "${title}"
Etiketler: ${tags.join(', ')}

Yanıt:`;

            const response = await client.messages.create({
                model: 'claude-3-haiku-20240307',
                max_tokens: 10,
                messages: [{ role: 'user', content: prompt }]
            });

            const aiResponse = response.content[0].text.trim().toUpperCase();
            
            if (aiResponse.includes('EVET')) {
                console.warn(`[Legal Guard] ❌ İhlal Tespit Edildi (AI Analizi)`);
                return { isSafe: false, reason: `AI tarafından potansiyel ticari marka ihlali tespit edildi.` };
            }

            console.log(`[Legal Guard] Aşama 2: ✅ AI Analizinden geçti.`);
            return { isSafe: true };

        } catch (err) {
            console.error('[Legal Guard] AI Validation Error:', err.message);
            // Hata durumunda sistemi durdurmuyoruz (false positive olmaması için)
            return { isSafe: true, reason: 'AI Validate edilemedi, statik geçildi.' };
        }
    }
}

module.exports = new SafetyService();
