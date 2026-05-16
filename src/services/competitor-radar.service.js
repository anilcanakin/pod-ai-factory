const { scrapeEtsyProducts } = require('./apify.service');
const brainService = require('./multimodal-brain.service');

const COMPETITOR_TTL_DAYS  = 90;
// Fiyat asimetri eşiği: max/min > bu oran ise "geniş fiyat aralığı" sinyali
const PRICE_GAP_RATIO      = 4;

// Fiyat asimetri analizi — İllüzyonist Power Seller tespiti
function _analyzePriceAsymmetry(products) {
    const prices = products.map(p => p.price).filter(p => p > 0);
    if (prices.length < 3) return null;

    const sorted   = [...prices].sort((a, b) => a - b);
    const minPrice = sorted[0];
    const maxPrice = sorted[sorted.length - 1];
    const avgPrice = prices.reduce((s, p) => s + p, 0) / prices.length;
    const medPrice = sorted[Math.floor(sorted.length / 2)];
    const gapRatio = maxPrice / (minPrice || 1);

    const isIllusionist = gapRatio >= PRICE_GAP_RATIO;

    return {
        minPrice: Math.round(minPrice * 100) / 100,
        maxPrice: Math.round(maxPrice * 100) / 100,
        avgPrice: Math.round(avgPrice * 100) / 100,
        medPrice: Math.round(medPrice * 100) / 100,
        gapRatio: Math.round(gapRatio * 10) / 10,
        isIllusionist,
        // Çok satılan fiyat dilimi (mod bucket, $5 aralıklar)
        sweetSpot: Math.round(medPrice / 5) * 5,
    };
}

class CompetitorRadarService {
    _buildMemoryText(shopName, shopUrl, products, priceData) {
        const listingLines = products
            .filter(d => d.title)
            .slice(0, 20)
            .map((d, i) =>
                `${i + 1}. "${d.title}"` +
                (d.price ? ` — $${d.price}` : '') +
                (d.sales ? ` (${d.sales} sales)` : '')
            )
            .join('\n');

        const wordFreq = {};
        products.forEach(d => {
            d.title.toLowerCase().split(/\W+/).filter(w => w.length > 3).forEach(w => {
                wordFreq[w] = (wordFreq[w] || 0) + 1;
            });
        });
        const topKeywords = Object.entries(wordFreq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([w]) => w)
            .join(', ');

        const priceSection = priceData ? `
PRICE ANALYSIS:
- Min: $${priceData.minPrice} | Max: $${priceData.maxPrice} | Avg: $${priceData.avgPrice} | Median: $${priceData.medPrice}
- Gap Ratio: ${priceData.gapRatio}x | Sweet Spot: ~$${priceData.sweetSpot}
${priceData.isIllusionist ? `⚠️ ILLUSIONIST POWER SELLER: Fiyat aralığı ${priceData.gapRatio}x — düşük fiyatlı ürünlerle trafik çekip yüksek fiyatlıya yönlendiriyor.` : ''}` : '';

        return `Competitor Shop: ${shopName}
Shop URL: ${shopUrl}
Scan Date: ${new Date().toISOString().split('T')[0]}
Total Listings Scanned: ${products.length}
${priceSection}
TOP LISTINGS:
${listingLines}

RECURRING KEYWORDS / NICHE SIGNALS:
${topKeywords || '(none detected)'}

STRATEGIC NOTES:
- These are the most visible products from ${shopName}'s storefront.
- Use recurring keywords for tag/title inspiration (not direct copy).
- Identify price anchors and niche opportunities from the listing data above.`;
    }

    async scanCompetitor(shopUrl, workspaceId = 'default-workspace') {
        const shopName = shopUrl.split('/shop/')[1]?.split('?')[0]?.split('/')[0] || shopUrl;
        console.log(`[Radar] Apify ile rakip taranıyor: ${shopName}`);

        try {
            // Apify ile mağaza adını keyword olarak ara
            const allProducts = await scrapeEtsyProducts(shopName, 50);

            // Mağaza adına göre filtrele — tam eşleşme varsa öncelik ver
            const normalize = s => (s || '').toLowerCase().replace(/\s+/g, '');
            const shopNorm = normalize(shopName);
            const shopProducts = allProducts.filter(p => normalize(p.shopName) === shopNorm);
            const finalProducts = shopProducts.length >= 3 ? shopProducts : allProducts;

            if (finalProducts.length === 0) {
                return { success: false, error: `"${shopName}" için ürün bulunamadı.`, designs: [] };
            }

            const priceData  = _analyzePriceAsymmetry(finalProducts);

            const designs = finalProducts.map(p => ({
                id: p.listingId,
                title: p.title,
                price: p.price ? `$${p.price}` : '',
                url: p.listingUrl,
                sales: p.sales,
            }));

            // Brain'e 90 günlük TTL ile kaydet (fire-and-forget)
            const expiresAt = new Date(Date.now() + COMPETITOR_TTL_DAYS * 24 * 60 * 60 * 1000);
            const memoryText = this._buildMemoryText(shopName, shopUrl, finalProducts, priceData);

            brainService.addTextKnowledge(
                workspaceId,
                `Competitor Scan: ${shopName} (${new Date().toLocaleDateString()})`,
                memoryText,
                shopUrl,
                'niche_research',
                expiresAt
            ).then(() => {
                console.log(`[Radar] "${shopName}" Brain'e kaydedildi (TTL: ${expiresAt.toISOString().split('T')[0]})`);
            }).catch(err => {
                console.warn('[Radar] Brain kayıt hatası:', err.message);
            });

            return { success: true, designs, priceAnalysis: priceData };
        } catch (error) {
            console.error('[Radar] Tarama hatası:', error.message);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new CompetitorRadarService();
