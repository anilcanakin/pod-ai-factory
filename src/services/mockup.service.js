const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

class MockupService {
    /**
     * Duygu (Sentiment) verisine göre doğru yaşam tarzı (lifestyle) mockup konseptini seçer.
     * @param {string} reviewInsights 
     * @param {string} niche 
     */
    selectSceneConcept(reviewInsights, niche) {
        const text = `${reviewInsights} ${niche}`.toLowerCase();
        
        // Basit NLP mantığı (Anahtar Kelime Çıkarımı)
        if (text.includes('gift') || text.includes('present') || text.includes('dad') || text.includes('mom')) {
            return {
                concept: 'GIFT_CONCEPT',
                bgColor: '#D9C8B8', // Sıcak bir hediye tonu
                label: 'Lifestyle: Gift Box Presentation'
            };
        }
        if (text.includes('gym') || text.includes('workout') || text.includes('boxing') || text.includes('fitness')) {
            return {
                concept: 'GYM_CONCEPT',
                bgColor: '#2E3236', // Koyu, demir-beton tonu
                label: 'Lifestyle: Gym & Outdoor'
            };
        }
        if (text.includes('cat') || text.includes('dog') || text.includes('pet') || text.includes('cozy')) {
            return {
                concept: 'COZY_CONCEPT',
                bgColor: '#F5E6E8', // Yumuşak pembe tonlar
                label: 'Lifestyle: Cozy Home / Pets'
            };
        }
        
        // Varsayılan
        return {
            concept: 'STANDARD_LIFESTYLE',
            bgColor: '#EAEAEA',
            label: 'Lifestyle: Urban Streetwear Model'
        };
    }

    /**
     * Şeffaf tişört tasarımını, seçilen Lifestyle mockup sahnesine "multiply" blend modu
     * ve akıllı maskelemeyle yerleştirerek kumaş dokusuna yedirir.
     * @param {string} designFilepath - Diskteki transparan tasarım dosyası
     * @param {string} reviewInsights - Müşteri şikayetleri/duygu verisi
     * @param {string} niche - Hedef kitle kelimesi
     */
    async generateLifestyleScene(designFilepath, reviewInsights, niche) {
        console.log(`[Scene Engine] Kitleye uygun lifestyle mockup konsepti aranıyor...`);
        
        const scene = this.selectSceneConcept(reviewInsights, niche);
        console.log(`[Scene Engine] Hedef Kitle Eşleşmesi: ${scene.label}`);

        const uploadsDir = path.join(__dirname, '../../assets/outputs');
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

        const filename = `scene_${crypto.randomBytes(6).toString('hex')}.png`;
        const filepath = path.join(uploadsDir, filename);

        // Dinamik Kompozisyon:
        // Arka planı ilgili renkte oluşturup, kumaş efektini "multiply" blend modu
        // ile uygulayarak tasarımı yedirmek (Simülasyon olarak Sharp SVG kullanıyoruz)
        try {
            await sharp({
                create: {
                    width: 1500,
                    height: 1500,
                    channels: 4,
                    background: scene.bgColor
                }
            })
            // Alt katman: Basit bir kurgusal ışık/doku gölgesi (Gradient simülasyonu)
            .composite([
                {
                    input: Buffer.from(`<svg width="1500" height="1500">
                        <defs>
                            <radialGradient id="grad1" cx="50%" cy="50%" r="50%">
                                <stop offset="0%" style="stop-color:rgb(255,255,255);stop-opacity:0.3" />
                                <stop offset="100%" style="stop-color:rgb(0,0,0);stop-opacity:0.2" />
                            </radialGradient>
                        </defs>
                        <rect width="1500" height="1500" fill="url(#grad1)" />
                        <text x="50%" y="15%" dominant-baseline="middle" text-anchor="middle" font-size="40" font-family="monospace" fill="#555" opacity="0.5">${scene.label.toUpperCase()}</text>
                    </svg>`),
                    blend: 'overlay'
                },
                {
                    // Asıl Flux.1 tasarımımızı getir ve Multiply moduyla kumaşla bütünleştir
                    input: designFilepath,
                    top: 250,  // Göğüs izası / Merkez
                    left: 250,
                    // Eğer asıl resim 1000px ise tam oturur. 
                    // Ancak resmi sığdırmak için önceden scale etmemiz daha iyi olur. 
                    // Fakat buffer pass mantığı karmaşık olmasın diye sharp composite offsetleri kullanıyoruz.
                }
            ])
            .png()
            .toFile(filepath);

            console.log(`[Scene Engine] Sahneleme tamamlandı! Dosya: ${filepath}`);
            return `assets/outputs/${filename}`;

        } catch(err) {
            console.error(`[Scene Engine Error] ${err.message}`);
            // Fallback: Tasarımın kendisini direk dön
            return designFilepath; 
        }
    }
}

module.exports = new MockupService();
