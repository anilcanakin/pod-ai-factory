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
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const util = require('util');
const ffprobe = util.promisify(ffmpeg.ffprobe);
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
async function downloadToTemp(url) {
    const fetch = require('node-fetch');
    const os = require('os');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch design: ${response.status}`);
    const buffer = await response.buffer();
    const tmpPath = path.join(os.tmpdir(), `design-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    fs.writeFileSync(tmpPath, buffer);
    return tmpPath;
}

async function renderMockup({ designPath, template, imageId, workspaceId, placement, areaDesigns }) {
    // Deterministic output path: assets/outputs/mockups/{workspaceId}/{imageId}_{templateId}.[ext]
    const outputDir = path.join(ASSETS_ROOT, 'outputs', 'mockups', workspaceId);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const baseExtStr = path.extname(template.baseImagePath || '').toLowerCase();
    const isVideo = ['.mp4', '.webm', '.mov'].includes(baseExtStr);

    const outputFilename = `${imageId}_${template.id}${isVideo ? '.mp4' : '.png'}`;
    const outputPath = path.join(outputDir, outputFilename);

    // Read config — Standard v1: { printArea, transform, render, meta }
    const config = template.configJson || {};
    const printArea = config.printArea || { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
    const transform = config.transform || {};
    const rotation = transform.rotation || 0;
    const opacity = typeof transform.opacity === 'number' ? transform.opacity : 1.0;
    // blendMode resolved later via brightness analysis — configJson value ignored

    // 1. Load base details & meta
    const basePath = path.isAbsolute(template.baseImagePath)
        ? template.baseImagePath
        : path.join(ASSETS_ROOT, '..', template.baseImagePath);

    let baseW, baseH;
    if (isVideo) {
        const metadata = await ffprobe(basePath);
        const stream = metadata.streams.find(s => s.codec_type === 'video') || metadata.streams[0];
        baseW = stream.width;
        baseH = stream.height;
    } else {
        const baseMeta = await sharp(basePath).metadata();
        baseW = baseMeta.width;
        baseH = baseMeta.height;
    }

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

    const designMeta = await sharp(designSource).metadata();
    const aspect = designMeta.height / designMeta.width;

    // Scale and rotate the design proportionally based on width ONLY
    const designW = Math.round(paW * scale);
    const designH = Math.round(designW * aspect);

    let resizedDesign = sharp(designSource)
        .resize(designW, designH, { fit: 'fill', background: { r: 0, g: 0, b: 0, alpha: 0 } });

    if (innerRotation !== 0) {
        resizedDesign = resizedDesign.rotate(innerRotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    }
    
    // Global template rotation fallback
    if (rotation !== 0) {
        resizedDesign = resizedDesign.rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    }

    let finalDesign = await resizedDesign.blur(0.4).png().toBuffer();
    const finalMeta = await sharp(finalDesign).metadata();
    const finalW = finalMeta.width;
    const finalH = finalMeta.height;

    // Calculate position
    const designX = Math.round(paX + (paW - finalW) / 2 + (offsetX * paW));
    const designY = Math.round(paY + (paH - finalH) / 2 + (offsetY * paH));

    // Clamp position to ensure design stays within base
    const clampedX = Math.max(0, Math.min(designX, baseW - 1));
    const clampedY = Math.max(0, Math.min(designY, baseH - 1));

    // If design would go outside base, resize it to fit
    const maxW = baseW - clampedX;
    const maxH = baseH - clampedY;

    if (finalW > maxW || finalH > maxH) {
        const fitScale = Math.min(maxW / finalW, maxH / finalH);
        const fittedW = Math.round(finalW * fitScale);
        const fittedH = Math.round(finalH * fitScale);
        
        finalDesign = await sharp(finalDesign)
            .resize(fittedW, fittedH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .toBuffer();
    }

    // Create a base-sized transparent envelope for the design
    let designLayer = await sharp({ create: { width: baseW, height: baseH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: finalDesign, left: clampedX, top: clampedY }])
        .png()
        .toBuffer();

    // 5. Mask clipping (scale to paW x paH, place into base layer, then clip)
    if (template.maskImagePath) {
        const maskFullPath = path.isAbsolute(template.maskImagePath)
            ? template.maskImagePath
            : path.join(ASSETS_ROOT, '..', template.maskImagePath);

        if (fs.existsSync(maskFullPath)) {
            const placedMask = await sharp({ create: { width: baseW, height: baseH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
                .composite([{
                    input: await sharp(maskFullPath).resize(paW, paH, { fit: 'fill' }).greyscale().png().toBuffer(),
                    left: paX, top: paY
                }])
                .png()
                .toBuffer();

            designLayer = await sharp(designLayer)
                .composite([{ input: placedMask, blend: 'dest-in' }])
                .png()
                .toBuffer();
        }
    }

    // 6. Opacity
    if (opacity < 1.0) {
        const alphaLayer = await sharp({
            create: { width: baseW, height: baseH, channels: 4, background: { r: 255, g: 255, b: 255, alpha: opacity } }
        }).png().toBuffer();

        designLayer = await sharp(designLayer)
            .composite([{ input: alphaLayer, blend: 'dest-in' }])
            .png()
            .toBuffer();
    }

    // 7. Blend mode
    let sharpBlend = 'multiply';
    if (!isVideo) {
        const { data: templateData } = await sharp(basePath)
            .greyscale()
            .resize(50, 50)
            .raw()
            .toBuffer({ resolveWithObject: true });

        const avgBrightness = templateData.reduce((sum, val) => sum + val, 0) / templateData.length;
        const requestedBlend = placement?.blendMode;
        sharpBlend = requestedBlend && requestedBlend !== 'auto'
            ? requestedBlend
            : (avgBrightness < 100 ? 'over' : 'multiply');
        console.log(`[Render] Template brightness: ${Math.round(avgBrightness)}, requested: ${requestedBlend || 'auto'}, blend: ${sharpBlend}`);
    } else {
        sharpBlend = placement?.blendMode && placement.blendMode !== 'auto' ? placement.blendMode : 'over';
        console.log(`[Render] Video mode blend: ${sharpBlend}`);
    }

    // 8. Build composites
    const composites = [{
        input: designLayer,
        left: 0,
        top: 0,
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
    const printAreas = config.printAreas;

    if (printAreas && printAreas.length > 0) {
        // Multi-area mode: apply design to the PRIMARY printArea + all extra printAreas.
        // The primary printArea is always included as the first entry so no shirt is missed.

        // Build the full list: primary first, then extra areas
        const allAreas = [
            { id: '__primary__', label: 'Primary', ...printArea },
            ...printAreas,
        ];

        console.log(`[Render] Multi-area mode: ${allAreas.length} area(s) (1 primary + ${printAreas.length} extra)`);
        console.log(`[Render] All areas:`, allAreas.map(a => `${a.id}[${a.label}]`));
        console.log(`[Render] areaDesigns keys:`, areaDesigns ? Object.keys(areaDesigns) : 'none (will use primary design for all)');

        // Start from a transparent overlay canvas
        let overlayBuffer = await sharp({ create: { width: baseW, height: baseH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
            .png().toBuffer();

        const tmpFiles = [];

        for (let i = 0; i < allAreas.length; i++) {
            const area = allAreas[i];

            const aX = Math.max(0, Math.round(area.x * baseW));
            const aY = Math.max(0, Math.round(area.y * baseH));
            const aW = Math.max(1, Math.min(Math.round(area.width * baseW), baseW - aX));
            const aH = Math.max(1, Math.min(Math.round(area.height * baseH), baseH - aY));

            // Try per-area custom design first, fallback to primary design
            const areaDesign = areaDesigns
                ? (areaDesigns[area.id] || areaDesigns[String(i)] || areaDesigns[i])
                : null;

            let aDesign;
            if (areaDesign?.imageUrl) {
                // Per-area custom design
                console.log(`[Render] Area ${i} ("${area.label || area.id}"): using custom design`);
                try {
                    const tmpPath = await downloadToTemp(areaDesign.imageUrl);
                    tmpFiles.push(tmpPath);
                    const aDesignW = Math.round(aW * scale);
                    const aDesignH = Math.round(aDesignW * (await sharp(tmpPath).metadata().then(m => m.height / m.width)));
                    aDesign = await sharp(tmpPath)
                        .resize(Math.min(aDesignW, aW), null, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                        .blur(0.4)
                        .png()
                        .toBuffer();
                } catch (err) {
                    console.error(`[Render] Area ${i}: failed to download custom design — ${err.message}. Falling back to primary.`);
                    aDesign = null;
                }
            }

            if (!aDesign) {
                // Fallback: scale primary design to fit this area with placement applied
                console.log(`[Render] Area ${i} ("${area.label || area.id}"): using primary design`);
                const aDesignW = Math.round(aW * scale);
                const primaryAspect = designMeta.height / designMeta.width;
                const aDesignH = Math.round(aDesignW * primaryAspect);

                let resized = sharp(designSource)
                    .resize(aDesignW, aDesignH, { fit: 'fill', background: { r: 0, g: 0, b: 0, alpha: 0 } });

                if (innerRotation !== 0) {
                    resized = resized.rotate(innerRotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
                }
                if (rotation !== 0) {
                    resized = resized.rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
                }
                aDesign = await resized.blur(0.4).png().toBuffer();
            }

            // Get actual dimensions after possible rotation
            const aDesignMeta = await sharp(aDesign).metadata();
            const aFinalW = aDesignMeta.width;
            const aFinalH = aDesignMeta.height;

            // Center within area, apply offsets
            const aPlacedX = Math.round(aX + (aW - aFinalW) / 2 + (offsetX * aW));
            const aPlacedY = Math.round(aY + (aH - aFinalH) / 2 + (offsetY * aH));
            const aClampedX = Math.max(0, Math.min(aPlacedX, baseW - 1));
            const aClampedY = Math.max(0, Math.min(aPlacedY, baseH - 1));

            // Apply opacity
            let finalAreaDesign = aDesign;
            if (opacity < 1.0) {
                const alphaLayer = await sharp({
                    create: { width: aFinalW, height: aFinalH, channels: 4, background: { r: 255, g: 255, b: 255, alpha: opacity } }
                }).png().toBuffer();
                finalAreaDesign = await sharp(aDesign)
                    .composite([{ input: alphaLayer, blend: 'dest-in' }])
                    .png()
                    .toBuffer();
            }

            overlayBuffer = await sharp(overlayBuffer)
                .composite([{ input: finalAreaDesign, left: aClampedX, top: aClampedY, blend: sharpBlend }])
                .png()
                .toBuffer();

            console.log(`[Render] Area ${i} done — composited at (${aClampedX},${aClampedY}) size ${aFinalW}x${aFinalH} within area (${aX},${aY}) ${aW}x${aH}`);
        }

        // Apply shadow overlay on top of all areas
        if (template.shadowImagePath) {
            const shadowFullPath = path.isAbsolute(template.shadowImagePath)
                ? template.shadowImagePath
                : path.join(ASSETS_ROOT, '..', template.shadowImagePath);

            if (fs.existsSync(shadowFullPath)) {
                const shadowBuffer = await sharp(shadowFullPath)
                    .resize(baseW, baseH, { fit: 'fill' })
                    .png()
                    .toBuffer();
                overlayBuffer = await sharp(overlayBuffer)
                    .composite([{ input: shadowBuffer, left: 0, top: 0, blend: 'multiply' }])
                    .png()
                    .toBuffer();
            }
        }

        if (isVideo) {
            console.log('[Render] Using FFmpeg for video multi-area composition...');
            const tempOverlay = path.join(os.tmpdir(), `overlay-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
            fs.writeFileSync(tempOverlay, overlayBuffer);
            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(basePath)
                    .input(tempOverlay)
                    .complexFilter('[0:v][1:v]overlay=0:0[out]')
                    .map('[out]')
                    .map('0:a?') // Keep audio if present
                    .videoCodec('libx264')
                    .outputOptions(['-pix_fmt yuv420p'])
                    .save(outputPath)
                    .on('end', resolve)
                    .on('error', reject);
            });
            fs.unlinkSync(tempOverlay);
        } else {
            // Apply the final overlay to the base image
            await sharp(basePath)
                .composite([{ input: overlayBuffer, left: 0, top: 0 }])
                .png()
                .toFile(outputPath);
        }

        // Clean up temp files
        tmpFiles.forEach(f => { try { fs.unlinkSync(f); } catch {} });

    } else {
        // Single-area mode
        let overlayBuffer = await sharp({ create: { width: baseW, height: baseH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
            .composite(composites)
            .png()
            .toBuffer();

        if (isVideo) {
            console.log('[Render] Using FFmpeg for video single-area composition...');
            const tempOverlay = path.join(os.tmpdir(), `overlay-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
            fs.writeFileSync(tempOverlay, overlayBuffer);
            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(basePath)
                    .input(tempOverlay)
                    .complexFilter('[0:v][1:v]overlay=0:0[out]')
                    .map('[out]')
                    .map('0:a?')
                    .videoCodec('libx264')
                    .outputOptions(['-pix_fmt yuv420p'])
                    .save(outputPath)
                    .on('end', resolve)
                    .on('error', reject);
            });
            fs.unlinkSync(tempOverlay);
        } else {
            await sharp(basePath)
                .composite([{ input: overlayBuffer, left: 0, top: 0 }])
                .png()
                .toFile(outputPath);
        }
    }

    // 10.5. Validate output file before upload
    const outputStats = fs.statSync(outputPath);
    console.log('[Render] Output file size:', outputStats.size, 'bytes');

    if (outputStats.size < 1000) {
        throw new Error('Rendered file is too small, likely corrupted');
    }

    const outputMetadata = await sharp(outputPath).metadata();
    console.log('[Render] Output dimensions:', outputMetadata.width, 'x', outputMetadata.height);

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

async function detectPrintArea(imagePath) {
    const sharp = require('sharp');
    
    const { data, info } = await sharp(imagePath)
        .greyscale()
        .resize(100, 100, { fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });

    const { width, height } = info;
    
    // Find the largest uniform (low variance) region
    // This is where the print area likely is
    const gridSize = 10;
    const cellW = Math.floor(width / gridSize);
    const cellH = Math.floor(height / gridSize);
    
    let bestScore = -1;
    let bestCell = { row: 2, col: 3 };
    
    for (let row = 0; row < gridSize; row++) {
        for (let col = 0; col < gridSize; col++) {
            const pixels = [];
            for (let y = row * cellH; y < (row + 1) * cellH; y++) {
                for (let x = col * cellW; x < (col + 1) * cellW; x++) {
                    pixels.push(data[y * width + x]);
                }
            }
            
            const mean = pixels.reduce((a, b) => a + b, 0) / pixels.length;
            const variance = pixels.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / pixels.length;
            
            // Best area: high brightness (light) AND low variance (uniform/flat)
            // This identifies the flat chest area of a shirt
            const score = mean - (variance * 0.5);
            
            if (score > bestScore) {
                bestScore = score;
                bestCell = { row, col, mean, variance };
            }
        }
    }
    
    // Build print area centered on best cell
    // For shirts: print area is typically 25-35% width, 30-40% height
    const printW = 0.30;
    const printH = 0.38;
    
    const centerX = (bestCell.col + 0.5) / gridSize;
    const centerY = (bestCell.row + 0.5) / gridSize;
    
    const x = Math.max(0.05, Math.min(0.65, centerX - printW / 2));
    const y = Math.max(0.05, Math.min(0.55, centerY - printH / 2));
    
    const confidence = Math.round((bestScore / 255) * 100);
    
    return {
        x: parseFloat(x.toFixed(3)),
        y: parseFloat(y.toFixed(3)),
        width: parseFloat(printW.toFixed(3)),
        height: parseFloat(printH.toFixed(3)),
        confidence: Math.min(95, Math.max(20, confidence))
    };
}

module.exports = { renderMockup, detectPrintArea };
