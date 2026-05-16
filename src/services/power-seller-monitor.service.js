const fs   = require('fs');
const path = require('path');
const { scrapeEtsyProducts } = require('./apify.service');
const brainService            = require('./multimodal-brain.service');

const STORES_FILE = path.join(__dirname, '../../data/tracked-stores.json');
const STATE_FILE  = path.join(__dirname, '../../data/power-seller-state.json');

// Hızlı traction sinyali eşikleri
const THRESHOLDS = {
    minFavoritesNew:  5,   // Yeni görülen ilan için anlık favori eşiği
    favGrowthPerScan: 3,   // Bir tarama arası favori artışı eşiği
    inCartMin:        3,   // Sepette ürün sayısı sinyali
    newListingWindowH: 72, // "Yeni" sayılan ilan yaşı (saat)
    alertTtlDays:    7,    // Brain kaydı TTL
};

function _readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return fallback; }
}

function _writeJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function _slugify(str) {
    return str.toLowerCase().replace(/\W+/g, '-').replace(/^-|-$/g, '');
}

function _extractShopName(shopUrl) {
    return shopUrl.split('/shop/')[1]?.split(/[/?#]/)[0] || shopUrl;
}

function _ageHours(isoStr) {
    return (Date.now() - new Date(isoStr).getTime()) / 3_600_000;
}

// ─── Store CRUD ───────────────────────────────────────────────────────────────

function getTrackedStores() {
    return _readJson(STORES_FILE, []);
}

function addTrackedStore({ shopUrl, shopName, notes = '' }) {
    const stores   = getTrackedStores();
    const name     = shopName || _extractShopName(shopUrl);
    const id       = _slugify(name);

    if (stores.find(s => s.id === id)) {
        return { success: false, error: 'Mağaza zaten takipte.' };
    }

    stores.push({ id, shopUrl, shopName: name, notes, addedAt: new Date().toISOString() });
    _writeJson(STORES_FILE, stores);
    return { success: true, store: { id, shopUrl, shopName: name } };
}

function removeTrackedStore(id) {
    let stores = getTrackedStores();
    const prev = stores.length;
    stores     = stores.filter(s => s.id !== id);
    if (stores.length === prev) return { success: false, error: 'Mağaza bulunamadı.' };

    _writeJson(STORES_FILE, stores);

    const state = _readJson(STATE_FILE, {});
    delete state[id];
    _writeJson(STATE_FILE, state);

    return { success: true };
}

// ─── Tek mağaza tarama ────────────────────────────────────────────────────────

async function _scanStore(store, storeState, workspaceId) {
    const alerts   = [];
    let products;

    try {
        products = await scrapeEtsyProducts(store.shopName, 30);
    } catch (err) {
        console.warn(`[PowerSeller] "${store.shopName}" tarama hatası: ${err.message}`);
        return { alerts, newStoreState: storeState };
    }

    // Sadece bu mağazanın ürünlerini al
    const normalize  = s => (s || '').toLowerCase().replace(/\s+/g, '');
    const shopNorm   = normalize(store.shopName);
    const filtered   = products.filter(p => normalize(p.shopName) === shopNorm);
    const finalProds = filtered.length >= 3 ? filtered : products;

    const now      = new Date().toISOString();
    const newState = {};

    for (const p of finalProds) {
        const lid   = String(p.listingId);
        const prev  = storeState[lid];
        const favs  = p.favoriteCount || 0;
        const sales = p.sales         || 0;

        if (!prev) {
            newState[lid] = { firstSeenAt: now, lastFavoriteCount: favs, lastSales: sales, lastSeenAt: now };

            // İlk görülmede zaten güçlü sinyal taşıyorsa alert at
            if (favs >= THRESHOLDS.minFavoritesNew || p.isBestSeller || p.isPopularNow || p.inCartCount >= THRESHOLDS.inCartMin) {
                alerts.push({ listing: p, reason: 'new_with_traction', favGrowth: favs });
            }
        } else {
            newState[lid] = { firstSeenAt: prev.firstSeenAt, lastFavoriteCount: favs, lastSales: sales, lastSeenAt: now };

            // Sadece yeni ilanları izle (< 72 saat)
            if (_ageHours(prev.firstSeenAt) <= THRESHOLDS.newListingWindowH) {
                const favGrowth = favs - (prev.lastFavoriteCount || 0);
                const hasGrowth = favGrowth >= THRESHOLDS.favGrowthPerScan;
                const hasSignal = p.isBestSeller || p.isPopularNow || p.inCartCount >= THRESHOLDS.inCartMin;

                if (hasGrowth || hasSignal) {
                    alerts.push({
                        listing: p,
                        reason:  hasSignal ? 'traction_signal' : 'fast_favorites',
                        favGrowth,
                    });
                }
            }
        }
    }

    // Alertleri Brain'e kaydet
    for (const { listing, reason, favGrowth } of alerts) {
        const expiresAt = new Date(Date.now() + THRESHOLDS.alertTtlDays * 86_400_000);
        const content =
            `[POWER SELLER ALERT] Mağaza: ${store.shopName}\n` +
            `İlan: "${listing.title}"\n` +
            `Fiyat: $${listing.price} | Favori: ${listing.favoriteCount} | Satış: ${listing.sales}\n` +
            `Sepet: ${listing.inCartCount} | BestSeller: ${listing.isBestSeller} | PopularNow: ${listing.isPopularNow}\n` +
            `Sinyal: ${reason} | Favori Artışı: +${favGrowth}\n` +
            `URL: ${listing.listingUrl}\n` +
            `Tespit: ${now}\n\n` +
            `TASARIM İÇGÖRÜSÜ: Bu ilan ${THRESHOLDS.newListingWindowH} saat içinde hızlı traction aldı. ` +
            `Niş/stil verileri batch tasarım üretimi için referans olabilir.`;

        try {
            await brainService.addTextKnowledge(
                workspaceId,
                `[POWER SELLER] ${store.shopName} — "${listing.title.slice(0, 60)}"`,
                content,
                listing.listingUrl,
                'niche_research',
                expiresAt
            );
        } catch (err) {
            console.warn('[PowerSeller] Brain kayıt hatası:', err.message);
        }
    }

    return { alerts, newStoreState: newState };
}

// ─── Tüm mağazaları tara ──────────────────────────────────────────────────────

async function scanAllStores(workspaceId = 'default-workspace') {
    const stores = getTrackedStores();
    if (!stores.length) {
        console.log('[PowerSeller] Takip edilen mağaza yok — tarama atlandı.');
        return { scanned: 0, totalAlerts: 0, storeResults: [] };
    }

    const state       = _readJson(STATE_FILE, {});
    const storeResults = [];

    for (const store of stores) {
        console.log(`[PowerSeller] "${store.shopName}" taranıyor...`);
        const { alerts, newStoreState } = await _scanStore(store, state[store.id] || {}, workspaceId);
        state[store.id] = newStoreState;

        storeResults.push({ shopName: store.shopName, alerts: alerts.length });
        if (alerts.length) {
            console.log(`[PowerSeller] ✅ ${store.shopName}: ${alerts.length} traction alert`);
        }
    }

    _writeJson(STATE_FILE, state);

    const totalAlerts = storeResults.reduce((s, r) => s + r.alerts, 0);
    console.log(`[PowerSeller] Tarama tamamlandı: ${stores.length} mağaza, ${totalAlerts} alert`);
    return { scanned: stores.length, totalAlerts, storeResults };
}

module.exports = { getTrackedStores, addTrackedStore, removeTrackedStore, scanAllStores };
