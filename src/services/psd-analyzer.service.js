const PSD = require('psd');
const sharp = require('sharp');
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

    // 1. Smart object → print area
    const smartLayer = findLayer(allLayers, SMART_KEYWORDS);
    let printArea;
    let smartLayerName = null;

    if (smartLayer) {
        const coords = smartLayer.coords || {
            top: smartLayer.layer?.top,
            left: smartLayer.layer?.left,
            bottom: smartLayer.layer?.bottom,
            right: smartLayer.layer?.right,
        };
        const valid = typeof coords.top === 'number' && typeof coords.left === 'number'
            && typeof coords.bottom === 'number' && typeof coords.right === 'number'
            && (coords.right - coords.left) > 0 && (coords.bottom - coords.top) > 0;

        if (valid) {
            printArea = boundsToNormalized(coords, psdWidth, psdHeight);
            smartLayerName = smartLayer.name;
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

    // 5. Default color (best-effort — falls back to white)
    const defaultColor = '#FFFFFF';

    return {
        printArea,
        baseBuffer,
        grayBuffer,
        shadowBuffer,
        defaultColor,
        layerMap: {
            smartObject: smartLayerName,
            shadow: shadowLayerName,
        },
    };
}

module.exports = { analyze };
