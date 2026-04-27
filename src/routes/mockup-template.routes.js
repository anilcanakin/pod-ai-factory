const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { detectPrintArea } = require('../services/mockup-render.service');

const prisma = require('../lib/prisma');

// Ensure base assets/mockups directory exists at startup
const MOCKUPS_BASE = path.join(__dirname, '../../assets/mockups');
if (!fs.existsSync(MOCKUPS_BASE)) {
    fs.mkdirSync(MOCKUPS_BASE, { recursive: true });
    console.log('[MockupTemplate] Created base directory:', MOCKUPS_BASE);
}

// Allowed categories — Standard v1
const VALID_CATEGORIES = ['tshirt', 'sweatshirt', 'hoodie', 'mug', 'sticker', 'phone_case'];

// Apparel presets — Standard v1
const CATEGORY_PRESETS = {
    tshirt: { printArea: { x: 0.35, y: 0.24, width: 0.30, height: 0.34 } },
    hoodie: { printArea: { x: 0.34, y: 0.26, width: 0.31, height: 0.35 } },
    sweatshirt: { printArea: { x: 0.35, y: 0.24, width: 0.30, height: 0.34 } },
    mug: { printArea: { x: 0.29, y: 0.36, width: 0.38, height: 0.26 } },
    sticker: { printArea: { x: 0.10, y: 0.10, width: 0.80, height: 0.80 } },
    phone_case: { printArea: { x: 0.12, y: 0.15, width: 0.76, height: 0.70 } },
};

// ─── Multer storage: save to tmp first, rename after parsing ─────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = req._templateDir || path.join(__dirname, '../../assets/mockups/tmp_upload');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || '.png';
        if (file.fieldname === 'baseImage') cb(null, `base${ext}`);
        else if (file.fieldname === 'maskImage') cb(null, `mask${ext}`);
        else if (file.fieldname === 'shadowImage') cb(null, `shadow${ext}`);
        else cb(null, file.originalname);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // increased to 100MB for videos
    fileFilter: (req, file, cb) => {
        const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.webm', '.mov'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error(`File type ${ext} not allowed. Use: ${allowed.join(', ')}`));
    }
});

// Create a unique tmp dir before upload
function prepareTmpDir(req, res, next) {
    const templateId = crypto.randomUUID();
    req._templateId = templateId;
    req._templateDir = path.join(__dirname, '../../assets/mockups/tmp_upload', templateId);
    if (!fs.existsSync(req._templateDir)) fs.mkdirSync(req._templateDir, { recursive: true });
    next();
}

// Wrap multer so its errors are caught and returned as JSON (not passed to Express default handler)
function runUpload(req, res) {
    return new Promise((resolve, reject) => {
        upload.fields([
            { name: 'baseImage', maxCount: 1 },
            { name: 'maskImage', maxCount: 1 },
            { name: 'shadowImage', maxCount: 1 },
        ])(req, res, (err) => {
            if (err) {
                console.error('[MockupTemplate] Multer error:', err.message, err.stack);
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

// ─── POST /api/mockups/templates ─────────────────────────────────────────────
router.post('/',
    prepareTmpDir,
    async (req, res) => {
        try {
            // Run multer inside the async handler so errors surface as JSON
            await runUpload(req, res);

            console.log('[MockupTemplate POST] Upload received — files:', Object.keys(req.files || {}), '— body keys:', Object.keys(req.body || {}));

            if (!req.workspaceId) {
                if (fs.existsSync(req._templateDir)) fs.rmSync(req._templateDir, { recursive: true, force: true });
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const baseFile = req.files?.baseImage?.[0];
            if (!baseFile) {
                if (fs.existsSync(req._templateDir)) fs.rmSync(req._templateDir, { recursive: true, force: true });
                return res.status(400).json({ error: 'Base image (baseImage) is required.' });
            }

            const templateId = req._templateId;
            const category = req.body.category || 'tshirt';

            // Validate category
            if (!VALID_CATEGORIES.includes(category)) {
                if (fs.existsSync(req._templateDir)) fs.rmSync(req._templateDir, { recursive: true, force: true });
                return res.status(400).json({ error: `Invalid category. Allowed: ${VALID_CATEGORIES.join(', ')}` });
            }

            // Standard v1: mv tmp dir to category dir
            const finalDir = path.join(__dirname, '../../assets/mockups', category, templateId);
            if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });

            // Move files manually to avoid Windows EPERM on folder rename
            const files = fs.readdirSync(req._templateDir);
            for (const f of files) {
                fs.copyFileSync(path.join(req._templateDir, f), path.join(finalDir, f));
            }
            fs.rmSync(req._templateDir, { recursive: true, force: true });

            const baseImagePath = `assets/mockups/${category}/${templateId}/${baseFile.filename}`;
            const maskFile = req.files?.maskImage?.[0];
            const shadowFile = req.files?.shadowImage?.[0];
            const maskImagePath = maskFile ? `assets/mockups/${category}/${templateId}/${maskFile.filename}` : null;
            const shadowImagePath = shadowFile ? `assets/mockups/${category}/${templateId}/${shadowFile.filename}` : null;

            const name = req.body.name || 'Untitled Template';

            // Build configJson — Standard v1 shape
            const preset = CATEGORY_PRESETS[category] || CATEGORY_PRESETS.tshirt;
            let configJson = {
                printArea: preset.printArea,
                transform: {
                    rotation: 0,
                    opacity: 0.92,
                    blendMode: 'multiply',
                },
                render: {
                    renderMode: 'flat',
                    displacementMapPath: null,
                    perspective: null,
                },
                meta: {
                    view: 'front',
                    background: 'studio',
                    color: 'white',
                    hasHumanModel: false,
                },
            };

            // Merge user-provided configJson
            if (req.body.configJson) {
                try {
                    const parsed = typeof req.body.configJson === 'string'
                        ? JSON.parse(req.body.configJson)
                        : req.body.configJson;

                    if (parsed.printArea) configJson.printArea = { ...configJson.printArea, ...parsed.printArea };
                    if (parsed.transform) configJson.transform = { ...configJson.transform, ...parsed.transform };
                    if (parsed.render) configJson.render = { ...configJson.render, ...parsed.render };
                    if (parsed.meta) configJson.meta = { ...configJson.meta, ...parsed.meta };
                } catch { /* use defaults */ }
            }

            // Write config.json to template directory — Standard v1
            const configFile = {
                id: templateId,
                name,
                category,
                baseImage: baseFile.filename,
                maskImage: maskFile ? maskFile.filename : null,
                shadowImage: shadowFile ? shadowFile.filename : null,
                thumbnailImage: null,
                ...configJson,
            };
            fs.writeFileSync(
                path.join(finalDir, 'config.json'),
                JSON.stringify(configFile, null, 2)
            );

            // Verify workspace exists before FK insert — prevents opaque 500 on stale cookies
            const workspace = await prisma.workspace.findUnique({ where: { id: req.workspaceId } });
            if (!workspace) {
                if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true, force: true });
                return res.status(401).json({ error: `Workspace not found. Please log out and log in again.` });
            }

            const template = await prisma.mockupTemplate.create({
                data: {
                    id: templateId,
                    workspaceId: req.workspaceId,
                    name,
                    category,
                    baseImagePath,
                    maskImagePath,
                    shadowImagePath,
                    configJson,
                }
            });

            res.json(template);
        } catch (err) {
            console.error('[MockupTemplate POST] Error:', err.message);
            console.error('[MockupTemplate POST] Stack:', err.stack);
            // Clean up tmp dir on any failure
            if (req._templateDir && fs.existsSync(req._templateDir)) {
                try { fs.rmSync(req._templateDir, { recursive: true, force: true }); } catch {}
            }
            const status = err.message?.toLowerCase().includes('not allowed') ? 400 : 500;
            res.status(status).json({ error: err.message });
        }
    }
);

// ─── GET /api/mockups/templates ──────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        if (!req.workspaceId) return res.status(401).json({ error: 'Unauthorized' });

        const where = { workspaceId: req.workspaceId };
        if (req.query.category) where.category = req.query.category;

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;

        const [templates, total] = await Promise.all([
            prisma.mockupTemplate.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            prisma.mockupTemplate.count({ where }),
        ]);

        res.json({ templates, total, page, limit });
    } catch (err) {
        console.error('[MockupTemplate GET]', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /api/mockups/templates/presets ──────────────────────────────────────
router.get('/presets', (req, res) => {
    res.json({ categories: VALID_CATEGORIES, presets: CATEGORY_PRESETS });
});

// ─── GET /api/mockups/templates/:id ──────────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        if (!req.workspaceId) return res.status(401).json({ error: 'Unauthorized' });

        const template = await prisma.mockupTemplate.findFirst({
            where: { id: req.params.id, workspaceId: req.workspaceId }
        });
        if (!template) return res.status(404).json({ error: 'Template not found' });
        res.json(template);
    } catch (err) {
        console.error('[MockupTemplate GET/:id]', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── PATCH /api/mockups/templates/:id ────────────────────────────────────────
router.patch('/:id', async (req, res) => {
    try {
        if (!req.workspaceId) return res.status(401).json({ error: 'Unauthorized' });

        const existing = await prisma.mockupTemplate.findFirst({
            where: { id: req.params.id, workspaceId: req.workspaceId }
        });
        if (!existing) return res.status(404).json({ error: 'Template not found' });

        const data = {};
        if (req.body.name) data.name = req.body.name;
        if (req.body.darkImagePath !== undefined) data.darkImagePath = req.body.darkImagePath;
        if (req.body.category) {
            if (!VALID_CATEGORIES.includes(req.body.category)) {
                return res.status(400).json({ error: `Invalid category. Allowed: ${VALID_CATEGORIES.join(', ')}` });
            }
            data.category = req.body.category;
        }

        if (req.body.configJson) {
            const prev = existing.configJson || {};
            const patch = req.body.configJson;
            data.configJson = {
                printArea: patch.printArea ? { ...prev.printArea, ...patch.printArea } : prev.printArea,
                // printAreas: array of {id, label, x, y, width, height} for multi-person/group mockups
                // If patch sends an explicit empty array, honour it; if omitted, keep existing
                printAreas: Array.isArray(patch.printAreas) ? patch.printAreas
                    : (Array.isArray(prev.printAreas) ? prev.printAreas : undefined),
                transform: patch.transform ? { ...prev.transform, ...patch.transform } : prev.transform,
                render: patch.render ? { ...prev.render, ...patch.render } : prev.render,
                meta: patch.meta ? { ...prev.meta, ...patch.meta } : prev.meta,
            };
            console.log(`[PATCH] configJson updated for ${existing.id}:`);
            console.log(`  printArea:`, JSON.stringify(data.configJson.printArea));
            console.log(`  printAreas (${Array.isArray(data.configJson.printAreas) ? data.configJson.printAreas.length : 0} areas):`,
                JSON.stringify(data.configJson.printAreas));
        }

        const template = await prisma.mockupTemplate.update({
            where: { id: existing.id },
            data,
        });
        res.json(template);
    } catch (err) {
        console.error('[MockupTemplate PATCH]', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── DELETE /api/mockups/templates/:id ───────────────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        if (!req.workspaceId) return res.status(401).json({ error: 'Unauthorized' });

        const template = await prisma.mockupTemplate.findFirst({
            where: { id: req.params.id, workspaceId: req.workspaceId }
        });
        if (!template) return res.status(404).json({ error: 'Template not found' });

        // Remove from assets/mockups/{category}/{templateId}/
        const dir = path.join(__dirname, '../../assets/mockups', template.category, template.id);
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }

        await prisma.mockupTemplate.delete({ where: { id: template.id } });
        res.json({ message: 'Template deleted' });
    } catch (err) {
        console.error('[MockupTemplate DELETE]', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/mockups/templates/detect-print-area — AI brightness-based print area detection
router.post('/detect-print-area', async (req, res) => {
    try {
        const { templateId } = req.body;
        if (!templateId) return res.status(400).json({ error: 'templateId required' });

        const template = await prisma.mockupTemplate.findFirst({
            where: { id: templateId, workspaceId: req.workspaceId },
        });
        if (!template) return res.status(404).json({ error: 'Template not found' });

        const imagePath = path.join(__dirname, '../../', template.baseImagePath);
        const printAreaResult = await detectPrintArea(imagePath);

        res.json({ printArea: {
            x: printAreaResult.x, y: printAreaResult.y, width: printAreaResult.width, height: printAreaResult.height
        }, confidence: printAreaResult.confidence / 100 });
    } catch (err) {
        console.error('[Detect Print Area]', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/bulk-upload', prepareTmpDir, async (req, res) => {
    try {
        if (!req.workspaceId) return res.status(401).json({ error: 'Unauthorized' });

        // Accept multiple files
        const upload = multer({
            storage: multer.diskStorage({
                destination: (req, file, cb) => cb(null, req._templateDir),
                filename: (req, file, cb) => cb(null, `base-${Date.now()}${path.extname(file.originalname)}`)
            }),
            fileFilter: (req, file, cb) => {
                if (file.mimetype.startsWith('image/')) cb(null, true);
                else cb(new Error('Images only'));
            },
            limits: { fileSize: 20 * 1024 * 1024 }
        });

        await new Promise((resolve, reject) => {
            upload.array('images', 20)(req, res, err => err ? reject(err) : resolve());
        });

        const { category = 'tshirt' } = req.body;
        const files = req.files;

        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No images provided' });
        }

        const sharp = require('sharp');
        const results = [];

        for (const file of files) {
            try {
                const templateId = require('crypto').randomUUID();
                const destDir = path.join(__dirname, `../../assets/mockups/${category}/${templateId}`);
                fs.mkdirSync(destDir, { recursive: true });

                const ext = path.extname(file.originalname);
                const destPath = path.join(destDir, `base${ext}`);
                fs.copyFileSync(file.path, destPath);

                const printAreaResult = await detectPrintArea(file.path);
                const printArea = {
                    x: printAreaResult.x,
                    y: printAreaResult.y,
                    width: printAreaResult.width,
                    height: printAreaResult.height
                };
                const confidence = printAreaResult.confidence;

                // Save to DB
                const template = await prisma.mockupTemplate.create({
                    data: {
                        id: templateId,
                        workspaceId: req.workspaceId,
                        name: path.basename(file.originalname, ext),
                        category,
                        baseImagePath: `assets/mockups/${category}/${templateId}/base${ext}`,
                        configJson: {
                            printArea,
                            transform: { rotation: 0, opacity: 1, blendMode: 'multiply' },
                            render: { renderMode: 'flat' },
                            meta: { view: 'front', background: 'studio', color: 'white', hasHumanModel: false }
                        }
                    }
                });

                results.push({
                    id: template.id,
                    name: template.name,
                    printArea,
                    confidence,
                    status: 'success'
                });

            } catch (err) {
                results.push({
                    name: file.originalname,
                    status: 'error',
                    error: err.message
                });
            }
        }

        res.json({ results, total: files.length, success: results.filter(r => r.status === 'success').length });

    } catch (err) {
        console.error('[Bulk Upload]', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/mockup-templates/render-video
router.post('/render-video', async (req, res) => {
    try {
        if (!req.workspaceId) return res.status(401).json({ error: 'Unauthorized' });

        const { mockupImageUrl, duration = 5, motionType = 'subtle' } = req.body;
        if (!mockupImageUrl) return res.status(400).json({ error: 'mockupImageUrl required' });

        // Fal.ai can't reach localhost URLs — require a public URL
        if (mockupImageUrl.includes('localhost') || mockupImageUrl.includes('127.0.0.1')) {
            return res.status(400).json({ error: 'mockupImageUrl must be a public URL (Supabase/CDN). Localhost URLs are not reachable by Fal.ai.' });
        }

        const { fal } = require('@fal-ai/client');

        const motionPrompts = {
            subtle: 'gentle fabric movement, slight breeze, natural motion',
            rotate: 'slow 360 degree rotation, product showcase',
            wave: 'fabric waving in wind, dynamic movement',
            zoom: 'slow zoom in on design, product focus'
        };

        const prompt = motionPrompts[motionType] || motionPrompts.subtle;
        const falDuration = duration >= 8 ? "10" : "5";

        console.log('[Video Render] Input:', { mockupImageUrl, duration, motionType, prompt });

        const result = await fal.subscribe('fal-ai/kling-video/v1/standard/image-to-video', {
            input: {
                image_url: mockupImageUrl,
                prompt,
                duration: falDuration,
            },
            logs: true,
            onQueueUpdate: (update) => {
                console.log('[Video Render] Status:', update.status, update.logs?.slice(-1)?.[0]?.message || '');
            }
        });

        console.log('[Video Render] Full result:', JSON.stringify(result, null, 2));

        const videoUrl = result?.data?.video?.url
            || result?.data?.output?.url
            || result?.video?.url
            || null;

        if (!videoUrl) {
            console.error('[Video Render] No videoUrl in result:', result);
            return res.status(500).json({ error: 'No video output returned', raw: result?.data });
        }

        res.json({ videoUrl, duration: falDuration, motionType });

    } catch (err) {
        console.error('[Video Render] Full error:', JSON.stringify(err, null, 2));
        console.error('[Video Render] Message:', err.message);
        console.error('[Video Render] Body:', err.body);
        res.status(500).json({
            error: err.message,
            detail: err.body || err.detail || {}
        });
    }
});

module.exports = router;
