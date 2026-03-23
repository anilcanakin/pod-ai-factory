const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } }
});

class AnalyticsService {
    /**
     * Process a single row from the Etsy analytics CSV export.
     * @param {Object} rowData - parsed CSV row
     */
    async processRow(rowData) {
        // Etsy CSV might have 'SKU' and various metrics
        const sku = rowData['SKU'] || rowData['sku'] || null;
        const impressions = parseInt(rowData['Impressions'] || rowData['impressions'] || 0, 10);
        const visits = parseInt(rowData['Visits'] || rowData['visits'] || 0, 10);
        const favorites = parseInt(rowData['Favorites'] || rowData['favorites'] || 0, 10);
        const orders = parseInt(rowData['Orders'] || rowData['orders'] || 0, 10);

        if (!sku) {
            console.warn("Analytics row missing SKU, skipping logic.");
            return null;
        }

        // We assume SKU is generated based on Image ID or directly matches Image ID for MVP.
        // Let's find an Image that might match this SKU.
        let image = await prisma.image.findFirst({
            where: { id: sku } // using exact ID for MVP assuming SKU = Image ID
        });

        if (!image) {
            console.warn(`[Analytics] Image not found for SKU: ${sku}. Skipping row to avoid relation errors.`);
            return null;
        }

        const imageId = image.id;

        // Calculate rates
        const ctr = impressions > 0 ? (visits / impressions) : 0;
        const favRate = visits > 0 ? (favorites / visits) : 0;
        const conversion = visits > 0 ? (orders / visits) : 0;

        // Calculate score 0-100 (30% CTR, 30% Favorites, 40% Orders)
        // Adjust these heuristics as needed
        const normCtr = Math.min(ctr / 0.1, 1); // 10% CTR is max score for this metric
        const normFav = Math.min(favRate / 0.1, 1); // 10% Fav rate is max
        const normConv = Math.min(conversion / 0.05, 1); // 5% Conversion is max

        let score = (normCtr * 30) + (normFav * 30) + (normConv * 40);
        score = Math.round(score * 10) / 10; // 1 decimal place

        // Determine Flags
        let flag = null;

        // Auto Kill Switch
        if (favorites === 0 && orders === 0 && impressions >= 200) {
            flag = 'LOW_SCORE';
        }

        // Best Performer (WINNER) overrides KILL switch if weird edge case
        if (conversion >= 0.03) {
            flag = 'WINNER';
        }

        // Upsert ProductPerformance
        const performance = await prisma.productPerformance.upsert({
            where: { imageId },
            update: {
                sku,
                impressions,
                visits,
                favorites,
                orders,
                score,
                flag
            },
            create: {
                imageId,
                sku,
                impressions,
                visits,
                favorites,
                orders,
                score,
                flag
            }
        });

        return performance;
    }
}

module.exports = new AnalyticsService();
