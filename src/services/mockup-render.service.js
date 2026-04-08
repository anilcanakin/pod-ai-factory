/**
 * mockup-render.service.js
 *
 * Sharp-based mockup render engine — Mockup Template Standard v1.
 *
 * Pipeline:
 *   1. Load base.jpg
 *   2. Calculate pixel printArea from normalized 0-1 coords
 *   3. Resize design PNG into print area
 *   4. Optional mask clipping
 *   5. Composite on base with blend mode + opacity
 *   6. Optional shadow overlay
 *   7. Export final PNG to deterministic path
 *
 * configJson shape:
 *   { printArea, transform: { rotation, opacity, blendMode }, render: { renderMode, ... }, meta: { ... } }
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { uploadToStorage } = require('./storage.service');

const ASSETS_ROOT = path.join(__dirname, '../../assets');

/**
 * @param {Object}  opts
 * @param {string}  opts.designPath   - absolute path to the design image
 * @param {Object}  opts.template     - MockupTemplate row from DB
 * @param {string}  opts.imageId      - the source image ID (for deterministic naming)
 * @param {string}  opts.workspaceId  - workspace ID (for output path scoping)
 * @param {Object}  opts.placement    - dynamic user placement { scale, offsetX, offsetY, rotation }
 * @returns {Promise<string>} - relative path to the generated mockup file
 */
async function renderMockup({ designPath, template, imageId, workspaceId, placement }) {
    // Deterministic output path: assets/outputs/mockups/{workspaceId}/{imageId}_{templateId}.png
    const outputDir = path.join(ASSETS_ROOT, 'outputs', 'mockups', workspaceId);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const outputFilename = `${imageId}_${template.id}.png`;
    const outputPath = path.join(outputDir, outputFilename);

    // Read config — Standard v1: { printArea, transform, render, meta }
    const config = template.configJson || {};
    const printArea = config.printArea || { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
    const transform = config.transform || {};
    const rotation = transform.rotation || 0;
    const opacity = typeof transform.opacity === 'number' ? transform.opacity : 1.0;
    const blendMode = transform.blendMode || 'normal';

    // 1. Load base image
    const basePath = path.isAbsolute(template.baseImagePath)
        ? template.baseImagePath
        : path.join(ASSETS_ROOT, '..', template.baseImagePath);

    const baseImage = sharp(basePath);
    const baseMeta = await baseImage.metadata();
    const baseW = baseMeta.width;
    const baseH = baseMeta.height;

    // 2. Calculate print area in pixels
    const paX = Math.round(printArea.x * baseW);
    const paY = Math.round(printArea.y * baseH);
    const paW = Math.max(1, Math.round(printArea.width * baseW));
    const paH = Math.max(1, Math.round(printArea.height * baseH));

    // 3. Fetch remote design if needed, then resize to fit print area
    let designSource = designPath;
    if (designPath.startsWith('http')) {
        const fetch = require('node-fetch');
        const res = await fetch(designPath);
        if (!res.ok) throw new Error(`Failed to fetch remote design: ${res.status}`);
        const arrayBuf = await res.arrayBuffer();
        designSource = Buffer.from(arrayBuf);
    }

    // 3. Dynamic Placement (Scale, Offset, Inner Rotation)
    const scale = placement?.scale || 1.0;
    const offsetX = placement?.offsetX || 0;
    const offsetY = placement?.offsetY || 0;
    const innerRotation = placement?.rotation || 0;

    // Scale and rotate the design proportionally
    const designW = Math.round(paW * scale);
    const designH = Math.round(paH * scale);

    let resizedDesign = sharp(designSource)
        .resize(designW, designH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });

    if (innerRotation !== 0) {
        // Rotate while preserving bounds (alpha: 0 background)
        resizedDesign = resizedDesign.rotate(innerRotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    }

    const resizedBuffer = await resizedDesign.png().toBuffer();

    // Check final dimensions after potential rotation expansion
    const { width: finalW, height: finalH } = await sharp(resizedBuffer).metadata();

    // Composite onto a strict paW x paH translucent canvas representing the print area bounds
    const left = Math.round((paW - finalW) / 2 + (offsetX * paW));
    const top = Math.round((paH - finalH) / 2 + (offsetY * paH));

    let designBuffer = await sharp({ create: { width: paW, height: paH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: resizedBuffer, top, left }])
        .png()
        .toBuffer();

    // 4. Apply rotation
    if (rotation !== 0) {
        designBuffer = await sharp(designBuffer)
            .rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .resize(paW, paH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toBuffer();
    }

    // 5. Mask clipping
    if (template.maskImagePath) {
        const maskFullPath = path.isAbsolute(template.maskImagePath)
            ? template.maskImagePath
            : path.join(ASSETS_ROOT, '..', template.maskImagePath);

        if (fs.existsSync(maskFullPath)) {
            const maskBuffer = await sharp(maskFullPath)
                .resize(paW, paH, { fit: 'fill' })
                .greyscale()
                .png()
                .toBuffer();

            designBuffer = await sharp(designBuffer)
                .composite([{ input: maskBuffer, blend: 'dest-in' }])
                .png()
                .toBuffer();
        }
    }

    // 6. Opacity
    if (opacity < 1.0) {
        const { width: dw, height: dh } = await sharp(designBuffer).metadata();
        const alphaLayer = await sharp({
            create: { width: dw, height: dh, channels: 4, background: { r: 255, g: 255, b: 255, alpha: opacity } }
        }).png().toBuffer();

        designBuffer = await sharp(designBuffer)
            .composite([{ input: alphaLayer, blend: 'dest-in' }])
            .png()
            .toBuffer();
    }

    // 7. Blend mode
    const sharpBlend = blendMode === 'multiply' ? 'multiply' : 'over';

    // 8. Build composites
    const composites = [{
        input: designBuffer,
        left: paX,
        top: paY,
        blend: sharpBlend,
    }];

    // 9. Shadow overlay
    if (template.shadowImagePath) {
        const shadowFullPath = path.isAbsolute(template.shadowImagePath)
            ? template.shadowImagePath
            : path.join(ASSETS_ROOT, '..', template.shadowImagePath);

        if (fs.existsSync(shadowFullPath)) {
            const shadowBuffer = await sharp(shadowFullPath)
                .resize(baseW, baseH, { fit: 'fill' })
                .png()
                .toBuffer();

            composites.push({
                input: shadowBuffer,
                left: 0,
                top: 0,
                blend: 'multiply',
            });
        }
    }

    // 10. Final composite and save
    await baseImage
        .composite(composites)
        .png()
        .toFile(outputPath);

    // 11. Upload to Supabase Storage
    let publicUrl = null;
    try {
        const storagePath = `mockups/${workspaceId}/${path.basename(outputPath)}`;
        publicUrl = await uploadToStorage(outputPath, storagePath);
        console.log('[Render] Uploaded to storage:', publicUrl);
        // Clean up local file after upload
        fs.unlink(outputPath, (err) => {
            if (err) console.warn('[Render] Failed to delete local file:', err.message);
        });
    } catch (storageErr) {
        console.warn('[Render] Storage upload failed, using local URL:', storageErr.message);
    }

    const resultUrl = publicUrl || `assets/outputs/mockups/${workspaceId}/${outputFilename}`;
    return resultUrl;
}

module.exports = { renderMockup };
