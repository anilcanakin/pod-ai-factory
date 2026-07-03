const express = require('express');
const router  = express.Router();
const etsy    = require('../services/etsy-api.service');

// GET /api/etsy/status
router.get('/status', async (req, res) => {
    try {
        const status = await etsy.getStatus(req.workspaceId);
        res.json(status);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/etsy/auth — OAuth URL döner
router.get('/auth', async (req, res) => {
    try {
        if (!process.env.ETSY_API_KEY || !process.env.ETSY_REDIRECT_URI) {
            return res.status(503).json({ error: 'ETSY_API_KEY veya ETSY_REDIRECT_URI .env\'de tanımlı değil.' });
        }
        const url = await etsy.getAuthUrl(req.workspaceId);
        res.json({ url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/etsy/callback — Etsy OAuth geri döner
router.get('/callback', async (req, res) => {
    const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:3000';
    const { code, state: workspaceId, error } = req.query;

    if (error) {
        return res.redirect(`${FRONTEND}/dashboard/settings?etsy=denied`);
    }
    if (!code || !workspaceId) {
        return res.redirect(`${FRONTEND}/dashboard/settings?etsy=error&reason=missing_params`);
    }

    try {
        await etsy.exchangeCode(workspaceId, code);
        res.redirect(`${FRONTEND}/dashboard/settings?etsy=connected`);
    } catch (err) {
        console.error('[Etsy Callback]', err.message);
        const reason = encodeURIComponent(err.message);
        res.redirect(`${FRONTEND}/dashboard/settings?etsy=error&reason=${reason}`);
    }
});

// POST /api/etsy/listings — Resmi API ile ilan oluştur
router.post('/listings', async (req, res) => {
    const { title, description, tags, price, imageUrls, imageId } = req.body;
    if (!title) return res.status(400).json({ error: 'title zorunlu' });

    try {
        const result = await etsy.createDraftListing(req.workspaceId, {
            title,
            description,
            tags,
            price: price ?? process.env.DEFAULT_LISTING_PRICE ?? '19.99',
            imageUrls,
        });

        // Eğer imageId verilmişse etsyListingId'yi SEOData'ya kaydet
        if (imageId && result.listingId) {
            const prisma = require('../lib/prisma');
            await prisma.sEOData.updateMany({
                where: { imageId },
                data:  { etsyListingId: BigInt(result.listingId) },
            }).catch(() => {});
        }

        res.json({ success: true, ...result });
    } catch (err) {
        console.error('[Etsy Listings]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/etsy/setup-info — Shipping profile + return policy ID'lerini döner
router.get('/setup-info', async (req, res) => {
    try {
        const accessToken = await etsy.getValidToken(req.workspaceId);
        let tokens = await etsy.getStatus(req.workspaceId);

        // shopId yoksa API'den çek ve kaydet
        if (!tokens.shopId) {
            try {
                const shop = await etsy.refreshShopInfo(req.workspaceId);
                tokens = { ...tokens, ...shop };
            } catch (shopErr) {
                return res.status(400).json({ error: `Shop ID alınamadı: ${shopErr.message}` });
            }
        }

        const headers = {
            'x-api-key':   `${process.env.ETSY_API_KEY}:${process.env.ETSY_API_SECRET}`,
            Authorization: `Bearer ${accessToken}`,
        };
        const base = `https://api.etsy.com/v3/application/shops/${tokens.shopId}`;

        // Shipping profiles
        const shippingRes = await fetch(`${base}/shipping-profiles`, { headers });
        const shipping    = shippingRes.ok ? await shippingRes.json() : null;

        // Return policies — önce direkt endpoint, başarısız olursa mevcut listingden çek
        let returnPolicies = [];
        const returnRes  = await fetch(`${base}/return-policies`, { headers });
        if (returnRes.ok) {
            const data = await returnRes.json();
            returnPolicies = (data?.results || []).map(p => ({
                id: p.return_policy_id, accepts_returns: p.accepts_returns,
            }));
        }

        // Direkt endpoint boş döndüyse mevcut bir listingden return_policy_id çek
        if (returnPolicies.length === 0) {
            const listingsRes = await fetch(
                `${base}/listings/active?limit=1&includes[]=MainImage`,
                { headers }
            );
            if (listingsRes.ok) {
                const listingsData = await listingsRes.json();
                const firstListing = listingsData?.results?.[0];
                if (firstListing?.return_policy_id) {
                    returnPolicies = [{ id: firstListing.return_policy_id, accepts_returns: true, source: 'listing' }];
                }
            }
        }

        res.json({
            shippingProfiles: (shipping?.results || []).map(p => ({
                id: p.shipping_profile_id, title: p.title,
            })),
            returnPolicies,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/etsy/return-policies — API üzerinden return policy oluştur
router.post('/return-policies', async (req, res) => {
    try {
        const accessToken = await etsy.getValidToken(req.workspaceId);
        let tokens = await etsy.getStatus(req.workspaceId);
        if (!tokens.shopId) {
            const shop = await etsy.refreshShopInfo(req.workspaceId);
            tokens = { ...tokens, ...shop };
        }

        const { accepts_returns = false, accepts_exchanges = false, return_deadline = null } = req.body;
        const apiKey = `${process.env.ETSY_API_KEY}:${process.env.ETSY_API_SECRET}`;

        const createRes = await fetch(
            `https://api.etsy.com/v3/application/shops/${tokens.shopId}/return-policies`,
            {
                method: 'POST',
                headers: {
                    'x-api-key':    apiKey,
                    Authorization:  `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ accepts_returns, accepts_exchanges, return_deadline }),
            }
        );
        const body = await createRes.text();
        if (!createRes.ok) {
            return res.status(createRes.status).json({ error: `Return policy oluşturulamadı: ${body}` });
        }
        const policy = JSON.parse(body);
        res.json({ success: true, id: policy.return_policy_id, accepts_returns: policy.accepts_returns });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/etsy/dispatch — imageId → SEO+mockup assembly → resmi API ile ilan oluştur
router.post('/dispatch', async (req, res) => {
    const { imageId } = req.body;
    if (!imageId) return res.status(400).json({ error: 'imageId zorunlu' });

    try {
        const prisma = require('../lib/prisma');

        const image = await prisma.image.findUnique({
            where: { id: imageId },
            include: { job: true },
        });
        if (!image) return res.status(404).json({ error: 'Görsel bulunamadı' });

        const seoContent = await prisma.sEOData.findFirst({ where: { imageId: image.id } });
        if (!seoContent) return res.status(400).json({ error: 'Önce SEO üretilmeli — SEO sayfasını kullanın' });

        const mockups = await prisma.image.findMany({
            where:   { jobId: image.jobId, engine: 'mockup' },
            orderBy: { createdAt: 'desc' },
            take: 5,
        });
        if (mockups.length < 1) {
            return res.status(400).json({ error: 'En az 1 mockup gerekli. Önce pipeline çalıştırın.' });
        }
        const primaryUrl     = mockups[0].imageUrl;
        const additionalUrls = mockups.slice(1).map(m => m.imageUrl);
        const imageUrls      = [primaryUrl, ...additionalUrls].filter(Boolean);
        const BASE_URL = process.env.BACKEND_URL || `http://localhost:3001`;
        const resolvedUrls = imageUrls.map(u => {
            if (!u) return null;
            if (u.startsWith('http')) return u;
            return `${BASE_URL}/${u.replace(/^\//, '')}`;
        }).filter(Boolean);

        const result = await etsy.createDraftListing(req.workspaceId, {
            title:       seoContent.title,
            description: seoContent.description + '\n\n---\nThis design was created using AI-based tools. Production partner: Prinella (Montebello, NY).',
            tags:        seoContent.tags,
            price:       process.env.DEFAULT_LISTING_PRICE || '19.99',
            imageUrls: resolvedUrls,
        });

        // etsyListingId'yi SEOData'ya kaydet
        if (result.listingId) {
            const prisma = require('../lib/prisma');
            await prisma.sEOData.updateMany({
                where: { imageId: image.id },
                data:  { etsyListingId: BigInt(result.listingId) },
            }).catch(() => {});
        }

        res.json({ success: true, message: 'Etsy taslağı oluşturuldu!', ...result });
    } catch (err) {
        console.error('[Etsy Dispatch]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/etsy/sync-performance — Etsy API'den views+favorites çek, ProductPerformance güncelle
router.post('/sync-performance', async (req, res) => {
    try {
        const prisma      = require('../lib/prisma');
        const accessToken = await etsy.getValidToken(req.workspaceId);
        const { shopId }  = await etsy.getStatus(req.workspaceId);
        if (!shopId) return res.status(400).json({ error: 'Shop ID bulunamadı' });

        const apiKey  = `${process.env.ETSY_API_KEY}:${process.env.ETSY_API_SECRET}`;
        const headers = { 'x-api-key': apiKey, Authorization: `Bearer ${accessToken}` };

        // etsyListingId kayıtlı SEO verilerini çek
        const seoRows = await prisma.sEOData.findMany({
            where:   { etsyListingId: { not: null }, image: { job: { workspaceId: req.workspaceId } } },
            select:  { imageId: true, etsyListingId: true },
        });

        if (seoRows.length === 0) {
            return res.json({ synced: 0, message: 'Henüz Etsy\'e gönderilmiş ilan yok.' });
        }

        let synced = 0;
        const errors = [];

        for (const row of seoRows) {
            try {
                const r = await fetch(
                    `https://api.etsy.com/v3/application/listings/${row.etsyListingId}`,
                    { headers }
                );
                if (!r.ok) { errors.push(`${row.etsyListingId}: ${r.status}`); continue; }
                const listing = await r.json();

                const views     = listing.views        ?? 0;
                const favorers  = listing.num_favorers ?? 0;

                await prisma.productPerformance.upsert({
                    where:  { imageId: row.imageId },
                    update: { impressions: views, favorites: favorers },
                    create: { imageId: row.imageId, impressions: views, favorites: favorers,
                              visits: 0, orders: 0, revenue: 0, score: 0 },
                });
                synced++;
            } catch (err) {
                errors.push(`${row.etsyListingId}: ${err.message}`);
            }
        }

        res.json({ synced, total: seoRows.length, errors });
    } catch (err) {
        console.error('[Etsy Sync]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/etsy/disconnect — Bağlantıyı kopar
router.delete('/disconnect', async (req, res) => {
    try {
        const prisma = require('../lib/prisma');
        await prisma.workspaceApiKey.deleteMany({
            where: { workspaceId: req.workspaceId, provider: 'etsy' },
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
