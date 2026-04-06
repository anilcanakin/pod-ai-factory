const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } }
});

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
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
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

// ─── POST /api/mockups/templates ─────────────────────────────────────────────
router.post('/',
    prepareTmpDir,
    upload.fields([
        { name: 'baseImage', maxCount: 1 },
        { name: 'maskImage', maxCount: 1 },
        { name: 'shadowImage', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
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
            console.error('[MockupTemplate POST]', err);
            res.status(500).json({ error: err.message });
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
                transform: patch.transform ? { ...prev.transform, ...patch.transform } : prev.transform,
                render: patch.render ? { ...prev.render, ...patch.render } : prev.render,
                meta: patch.meta ? { ...prev.meta, ...patch.meta } : prev.meta,
            };
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

module.exports = router;
