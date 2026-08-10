const PSD = require('psd');
const sharp = require('../lib/sharp-safe');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { detectPrintArea } = require('./mockup-render.service');

const SMART_KEYWORDS = ['design', 'artwork', 'place', 'your', 'motif', 'print', 'grafik', 'tasarim', 'tasarım', 'smartobject'];
const SHADOW_KEYWORDS = ['shadow', 'highlight', 'shading', 'overlay', 'wrinkle', 'fold', 'texture', 'gölge', 'doku'];

function flattenLayers(nodes) {
    const result = [];
    for (const node of nodes) {
        result.push(node);
        if (node.isGroup() && node.children && node.children().length) {
            result.push(...flattenLayers(node.children()));
        }
    }
    return result;
}

function findLayer(layers, keywords) {
    return layers.find(l => {
        const name = (l.name || '').toLowerCase().replace(/\s+/g, '');
        return keywords.some(k => name.includes(k));
    }) || null;
}

function findAllSmartLayers(layers, keywords) {
    return layers.filter(l => {
        const name = (l.name || '').toLowerCase().replace(/\s+/g, '');
        return keywords.some(k => name.includes(k));
    });
}

const AREA_LABELS = ['Front', 'Back', 'Sleeve Left', 'Sleeve Right', 'Hood', 'Pocket'];


function boundsToNormalized(coords, psdWidth, psdHeight) {
    const { top, left, bottom, right } = coords;
    const x = left / psdWidth;
    const y = top / psdHeight;
    const w = (right - left) / psdWidth;
    const h = (bottom - top) / psdHeight;
    return {
        x: parseFloat(Math.max(0, x).toFixed(4)),
        y: parseFloat(Math.max(0, y).toFixed(4)),
        width: parseFloat(Math.min(1 - x, w).toFixed(4)),
        height: parseFloat(Math.min(1 - y, h).toFixed(4)),
    };
}

async function renderLayerToPng(layer, psdWidth, psdHeight) {
    try {
        // Try pixelData first, fallback to toPng().data
        let rawBuf;
        try {
            const png = layer.image.toPng();
            rawBuf = png && png.data ? Buffer.from(png.data) : null;
        } catch {
            rawBuf = null;
        }
        if (!rawBuf || rawBuf.length === 0) return null;

        const lw = layer.layer.width || layer.width;
        const lh = layer.layer.height || layer.height;
        if (!lw || !lh) return null;

        const left = Math.max(0, layer.layer.left || 0);
        const top  = Math.max(0, layer.layer.top  || 0);

        // Layer pixel data → PNG buffer
        const layerPng = await sharp(Buffer.from(rawBuf), {
            raw: { width: lw, height: lh, channels: 4 }
        }).png().toBuffer();

        // Place layer on full-canvas-sized transparent image
        const fullCanvas = await sharp({
            create: { width: psdWidth, height: psdHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
        })
            .composite([{ input: layerPng, left: Math.max(0, left), top: Math.max(0, top) }])
            .png()
            .toBuffer();

        return fullCanvas;
    } catch (err) {
        console.warn('[psd-analyzer] renderLayerToPng failed:', err.message);
        return null;
    }
}

/**
 * Analyze a PSD file and return extracted assets.
 * @param {string} psdFilePath  Absolute path to the .psd file
 * @param {string} category     Template category (for preset shadow fallback)
 * @returns {{ printArea, baseBuffer, grayBuffer, shadowBuffer, defaultColor, layerMap }}
 */
async function analyze(psdFilePath, category = 'tshirt') {
    const psd = PSD.fromFile(psdFilePath);
    psd.parse();

    const psdWidth = psd.header.width;
    const psdHeight = psd.header.height;
    const allLayers = flattenLayers(psd.tree().children());

    // 1. Smart objects → print areas (multi-area support)
    const allSmartLayers = findAllSmartLayers(allLayers, SMART_KEYWORDS);
    let printArea;
    let smartLayerName = null;
    const printAreas = [];

    for (let i = 0; i < allSmartLayers.length; i++) {
        const layer = allSmartLayers[i];
        const coords = layer.coords || {
            top: layer.layer?.top,
            left: layer.layer?.left,
            bottom: layer.layer?.bottom,
            right: layer.layer?.right,
        };
        const valid = typeof coords.top === 'number' && typeof coords.left === 'number'
            && typeof coords.bottom === 'number' && typeof coords.right === 'number'
            && (coords.right - coords.left) > 0 && (coords.bottom - coords.top) > 0;

        if (valid) {
            const normalized = boundsToNormalized(coords, psdWidth, psdHeight);
            const id = (AREA_LABELS[i] || `Area ${i + 1}`).toLowerCase().replace(/\s+/g, '_');
            printAreas.push({ id, label: AREA_LABELS[i] || `Area ${i + 1}`, ...normalized });
            if (i === 0) {
                printArea = normalized;
                smartLayerName = layer.name;
            }
        }
    }

    // 2. Full flatten → base buffer (saveAsPng only once)
    const baseTmp = path.join(os.tmpdir(), `psd-base-${Date.now()}.png`);
    await psd.image.saveAsPng(baseTmp);
    const baseBuffer = fs.readFileSync(baseTmp);

    if (!printArea) {
        printArea = await detectPrintArea(baseTmp);
    }
    try { fs.unlinkSync(baseTmp); } catch {}

    // 3. Greyscale → gray_base buffer
    const grayBuffer = await sharp(baseBuffer)
        .greyscale()
        .png()
        .toBuffer();

    // 4. Shadow layer
    const shadowLayer = findLayer(allLayers, SHADOW_KEYWORDS);
    let shadowBuffer = null;
    let shadowLayerName = null;

    if (shadowLayer) {
        shadowBuffer = await renderLayerToPng(shadowLayer, psdWidth, psdHeight);
        if (shadowBuffer) shadowLayerName = shadowLayer.name;
    }

    // 5. Ortalama parlaklıktan blend mode tespiti
    // Gray buffer zaten elimizde — küçük boyuta resize et, ortalama brightness hesapla
    const { data: brightnessData, info: bInfo } = await sharp(grayBuffer)
        .resize(50, 50, { fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });
    const avgBrightness = Array.from(brightnessData).reduce((s, v) => s + v, 0) / (bInfo.width * bInfo.height);
    const blendMode = avgBrightness > 127 ? 'multiply' : 'screen';
    const defaultColor = avgBrightness > 127 ? '#FFFFFF' : '#1a1a1a';

    return {
        printArea,
        printAreas: printAreas.length > 0 ? printAreas : null,
        baseBuffer,
        grayBuffer,
        shadowBuffer,
        defaultColor,
        blendMode,
        layerMap: {
            smartObject: smartLayerName,
            shadow: shadowLayerName,
        },
    };
}

module.exports = { analyze };
