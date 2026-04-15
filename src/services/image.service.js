const Replicate = require("replicate");
const axios = require("axios");

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const Anthropic = require("@anthropic-ai/sdk");
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const knowledgeContext = require("./knowledge-context.service");

class ImageService {
  // 1. Prompt Jeneratörü: Market Intel + Duygu Analizini Sanat Komutuna Dönüştürür
  async generatePrompt(marketData, reviewInsights) {
    const { trendTerms = [], pinterestTrends = [] } = marketData || {};
    const keyword = trendTerms[0] || pinterestTrends[0] || "viral design";
    const brainContext = await knowledgeContext.getIdeasContext('default-workspace');
    
    const baseStyle = "clean vector t-shirt design, flat illustration, isolated on white background, high contrast, professional graphic design, 8k resolution";
    
    // Yorumlar yoksa statik fallback
    if (!reviewInsights || reviewInsights.length < 5) {
       return `A ${keyword} themed design, ${baseStyle}, minimalist aesthetic, trending on Pinterest.`;
    }

    console.log(`[Yaratıcı Motor] Claude 3, ${keyword} müşteri şikayetlerini okuyor...`);
    
    const systemPrompt = `Sen bir Print-On-Demand ürün tişört sanatçısısın (Prompt Engineer).
Görevin FLUX.1 imaj üretici modeli için kısa, tek cümlelik İngilizce bir image prompt yazmaktır.
Tasarım "white background" (beyaz arkaplan) üzerine olmalı.

İşte Rakip Ürünlerin Çalıştığın Nişle İlgili Müşteri Şikayetleri/Yorumları:
"${reviewInsights.slice(0, 500)}"

Rakiplerin yorumlarını analiz et. Müşterilerin şikayet ettiği sorunları çöz:
- Eğer insanlar 'tasarım çok kalabalık/karmaşık' diyorsa, Flux.1 promptuna daha minimalist talimatlar ekle.
- Eğer 'renkler soluk' diyorsa, prompta 'vibrant, high-saturated colors' gibi komutlar ekle.
- Eğer 'yazılar bulanık/okunmuyor' diyorsa typography üzerine 'bold readable text' iste.

Base Style: ${baseStyle}
Hedef Kelime: ${keyword}

## STRATEGY CONTEXT (Use prioritized Expert advice if available):
${brainContext}

SADECE kullanman gereken tek cümlelik İngilizce promptu dön. (Extra açıklama yapma)`;

    try {
        const response = await anthropic.messages.create({
            model: 'claude-3-haiku-20240307',
            max_tokens: 300,
            system: systemPrompt,
            messages: [{ role: 'user', content: 'Yukarıdaki kurallara göre Flux.1 için tişört tasarım promptunu oluştur.' }]
        });
        
        const generatedPrompt = response.content[0].text.trim();
        console.log(`[Yaratıcı Motor] ✅ Duygu Analizli Prompt Üretildi: "${generatedPrompt}"`);
        return generatedPrompt;
    } catch (err) {
        console.error('[Yaratıcı Motor] Prompt oluşturma hatası, fallback uygulanıyor:', err.message);
        return `A ${keyword} themed design, ${baseStyle}, minimalist aesthetic, trending on Pinterest.`;
    }
  }

  // 2. Görsel Üretimi (Flux.1)
  async generateImage(prompt) {
    console.log(`[Flux.1] Görsel üretiliyor: ${prompt}`);
    const output = await replicate.run(
      "black-forest-labs/flux-schnell", // Hızlı ve kaliteli model
      { input: { prompt: prompt, num_outputs: 1, aspect_ratio: "1:1" } }
    );
    // output usually is an array of urls for flux-schnell
    return output[0]; // Görsel URL'si döner
  }

  // 3. Arka Plan Silme (Remove.bg)
  async removeBackground(imageUrl) {
    console.log(`[Remove.bg] Arka plan temizleniyor...`);
    const response = await axios.post(
      "https://api.remove.bg/v1.0/removebg",
      { image_url: imageUrl, size: "auto" },
      {
        headers: { "X-Api-Key": process.env.REMOVE_BG_API_KEY },
        responseType: "arraybuffer", // Buffer dönecek
      }
    );
    return response.data; // Temizlenmiş görsel buffer'ı
  }
}

module.exports = new ImageService();
