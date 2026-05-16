const fs = require('fs');
const path = require('path');

const CATALOG_PATH = path.join(__dirname, '../../data/yuppion-catalog.json');

function readCatalog() {
    try {
        return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    } catch {
        return { lastUpdated: null, products: [] };
    }
}

function writeCatalog(catalog) {
    catalog.lastUpdated = new Date().toISOString().split('T')[0];
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8');
}

function getProducts() {
    return readCatalog().products;
}

function getProductColors(modelId) {
    const catalog = readCatalog();
    const product = catalog.products.find(p => p.modelId === modelId);
    if (!product) return null;
    return {
        modelId: product.modelId,
        name: product.name,
        category: product.category,
        colors: product.colors.filter(c => c.inStock !== false),
        sizes: product.sizes,
    };
}

// ─── Renk Mesafe & Eşleştirme ─────────────────────────────────────────────────

function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
    };
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

// Perceptual RGB distance (weighted to mimic human vision)
function colorDistance(hex1, hex2) {
    const a = hexToRgb(hex1);
    const b = hexToRgb(hex2);
    const rMean = (a.r + b.r) / 2;
    const dr = a.r - b.r;
    const dg = a.g - b.g;
    const db = a.b - b.b;
    // Redmean formula — better perceptual accuracy than simple Euclidean
    return Math.sqrt(
        (2 + rMean / 256) * dr * dr +
        4 * dg * dg +
        (2 + (255 - rMean) / 256) * db * db
    );
}

// MAX_DISTANCE ≈ 765 for plain Euclidean; Redmean is similar scale
const MATCH_TOLERANCE = 100; // ~13% of max range — tight enough to be meaningful

/**
 * modelId verilirse sadece o modelin renklerine bakar; verilmezse tüm katalogda arar.
 * Returns { color: { name, hex }, distance, matched } or null if catalog empty
 */
function findClosestColor(detectedHex, modelId = null, tolerance = MATCH_TOLERANCE) {
    const catalog = readCatalog();
    let colors = [];

    if (modelId) {
        const product = catalog.products.find(p => p.modelId === modelId);
        if (!product) return null;
        colors = product.colors.filter(c => c.inStock !== false);
    } else {
        catalog.products.forEach(p => {
            p.colors.filter(c => c.inStock !== false).forEach(c => colors.push(c));
        });
    }

    if (colors.length === 0) return null;

    let best = null;
    let bestDist = Infinity;
    for (const color of colors) {
        const dist = colorDistance(detectedHex, color.hex);
        if (dist < bestDist) {
            bestDist = dist;
            best = color;
        }
    }

    return {
        color: { name: best.name, hex: best.hex },
        distance: Math.round(bestDist),
        matched: bestDist <= tolerance,
    };
}

/**
 * Görsel dosyasındaki baskın giysi rengini Sharp ile tespit eder.
 * Arka plan (açık) ve şeffaf pikselleri dışlar.
 * Returns hex string or null.
 */
async function detectGarmentColor(imagePath) {
    const sharp = require('sharp');

    let sharpInst = sharp(imagePath);
    const meta = await sharpInst.metadata();
    const { width, height } = meta;
    if (!width || !height) return null;

    // Ortanın %50x60'ını al (giysi gövdesi)
    const left = Math.floor(width * 0.25);
    const top = Math.floor(height * 0.20);
    const cropW = Math.floor(width * 0.50);
    const cropH = Math.floor(height * 0.60);

    const { data, info } = await sharp(imagePath)
        .extract({ left, top, width: cropW, height: cropH })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const ch = info.channels; // always 4 after ensureAlpha
    let rSum = 0, gSum = 0, bSum = 0, count = 0;

    for (let i = 0; i < data.length; i += ch) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a < 180) continue;                    // şeffaf
        if (r > 232 && g > 232 && b > 232) continue; // açık arka plan / beyaz
        if (r < 12 && g < 12 && b < 12) continue;    // saf siyah gölgeler
        rSum += r; gSum += g; bSum += b; count++;
    }

    if (count < 200) return null; // yeterli piksel yok
    return rgbToHex(rSum / count, gSum / count, bSum / count);
}

/**
 * Görsel dosyasını analiz eder + katalogla eşleştirir.
 * Returns { detectedColor, match: { color, distance, matched } }
 */
async function detectAndMatch(imagePath, modelId = null) {
    const detectedColor = await detectGarmentColor(imagePath);
    if (!detectedColor) return { detectedColor: null, match: null };

    const match = findClosestColor(detectedColor, modelId);
    return { detectedColor, match };
}

// ─── Catalog CRUD ──────────────────────────────────────────────────────────────

function importFromJson(productsArray) {
    if (!Array.isArray(productsArray)) throw new Error('Expected an array of products');
    const catalog = readCatalog();
    catalog.products = productsArray;
    writeCatalog(catalog);
    return { imported: productsArray.length };
}

function updateModelColors(modelId, colorList) {
    const catalog = readCatalog();
    const idx = catalog.products.findIndex(p => p.modelId === modelId);
    if (idx === -1) throw new Error(`Model ${modelId} not found in catalog`);
    catalog.products[idx].colors = colorList;
    writeCatalog(catalog);
    return catalog.products[idx];
}

function mergeModelColors(modelId, incomingNames) {
    const catalog = readCatalog();
    const idx = catalog.products.findIndex(p => p.modelId === modelId);
    if (idx === -1) throw new Error(`Model ${modelId} not found in catalog`);

    const existing = catalog.products[idx].colors;
    existing.forEach(c => { c.inStock = incomingNames.includes(c.name); });
    incomingNames.forEach(name => {
        if (!existing.find(c => c.name === name)) {
            existing.push({ name, hex: '#888888', inStock: true });
        }
    });
    catalog.products[idx].colors = existing;
    writeCatalog(catalog);
    return catalog.products[idx];
}

function importFromCsv(csvText) {
    const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
    const errors = [];
    let imported = 0;

    const catalog = readCatalog();
    const byModel = {};

    lines.forEach((line, i) => {
        if (i === 0 && line.toLowerCase().startsWith('modelid')) return;
        const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
        if (parts.length < 3) { errors.push(`Satır ${i + 1}: yetersiz sütun`); return; }
        const [modelId, colorName, hex, inStockRaw] = parts;
        if (!byModel[modelId]) byModel[modelId] = [];
        byModel[modelId].push({
            name: colorName,
            hex: hex || '#888888',
            inStock: inStockRaw === undefined || inStockRaw.toLowerCase() !== 'false',
        });
        imported++;
    });

    Object.entries(byModel).forEach(([modelId, colors]) => {
        const idx = catalog.products.findIndex(p => p.modelId === modelId);
        if (idx === -1) {
            catalog.products.push({ modelId, name: modelId, category: 'tshirt', sizes: [], colors });
        } else {
            const existingMap = {};
            catalog.products[idx].colors.forEach(c => { existingMap[c.name] = c; });
            colors.forEach(c => { existingMap[c.name] = { ...existingMap[c.name], ...c }; });
            catalog.products[idx].colors = Object.values(existingMap);
        }
    });

    writeCatalog(catalog);
    return { imported, errors, models: Object.keys(byModel).length };
}

function getSummary() {
    const catalog = readCatalog();
    return {
        lastUpdated: catalog.lastUpdated,
        totalProducts: catalog.products.length,
        totalColors: catalog.products.reduce((sum, p) => sum + (p.colors?.length || 0), 0),
        byCategory: catalog.products.reduce((acc, p) => {
            acc[p.category] = (acc[p.category] || 0) + 1;
            return acc;
        }, {}),
    };
}

module.exports = {
    getProducts,
    getProductColors,
    findClosestColor,
    detectGarmentColor,
    detectAndMatch,
    importFromJson,
    importFromCsv,
    updateModelColors,
    mergeModelColors,
    getSummary,
};
