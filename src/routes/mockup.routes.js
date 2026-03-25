const express = require('express');
const router = express.Router();
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { renderMockup } = require('../services/mockup-render.service');

const prisma = new PrismaClient();

// POST /api/mockups/render — render a single mockup
router.post('/render', async (req, res) => {
    try {
        if (!req.workspaceId) return res.status(401).json({ error: 'Unauthorized' });

        const { imageId, templateId, placement } = req.body;
        if (!imageId || !templateId) {
            return res.status(400).json({ error: 'imageId and templateId are required' });
        }

        // Verify image belongs to workspace
        const image = await prisma.image.findFirst({
            where: { id: imageId, job: { workspaceId: req.workspaceId } }
        });
        if (!image) return res.status(403).json({ error: 'Image not found or access denied' });

        // Verify template belongs to workspace
        const template = await prisma.mockupTemplate.findFirst({
            where: { id: templateId, workspaceId: req.workspaceId }
        });
        if (!template) return res.status(403).json({ error: 'Template not found or access denied' });

        // Determine design path
        let designPath = image.masterFileUrl || image.imageUrl;
        if (!designPath || designPath === 'PENDING') {
            return res.status(400).json({ error: 'Image does not have a renderable file. Ensure it is PROCESSED.' });
        }
        if (!designPath.startsWith('http') && !path.isAbsolute(designPath)) {
            designPath = path.join(__dirname, '../../', designPath);
        }

        // Standard v1: pass imageId + workspaceId for deterministic output path
        const mockupUrl = await renderMockup({
            designPath,
            template,
            workspaceId: req.workspaceId,
            placement,
        });

        const mockup = await prisma.mockup.create({
            data: { imageId, templateId, mockupUrl }
        });

        res.json(mockup);
    } catch (err) {
        console.error('[Mockup /render]', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/mockups/render-batch — render multiple templates for one image
router.post('/render-batch', async (req, res) => {
    try {
        if (!req.workspaceId) return res.status(401).json({ error: 'Unauthorized' });

        const { imageId, templateIds, placement } = req.body;
        if (!imageId || !templateIds || !Array.isArray(templateIds) || templateIds.length === 0) {
            return res.status(400).json({ error: 'imageId and templateIds[] are required' });
        }

        const image = await prisma.image.findFirst({
            where: { id: imageId, job: { workspaceId: req.workspaceId } }
        });
        if (!image) return res.status(403).json({ error: 'Image not found or access denied' });

        let designPath = image.masterFileUrl || image.imageUrl;
        if (!designPath || designPath === 'PENDING') {
            return res.status(400).json({ error: 'Image does not have a renderable file.' });
        }
        if (!designPath.startsWith('http') && !path.isAbsolute(designPath)) {
            designPath = path.join(__dirname, '../../', designPath);
        }

        const templates = await prisma.mockupTemplate.findMany({
            where: { id: { in: templateIds }, workspaceId: req.workspaceId }
        });

        if (templates.length === 0) {
            return res.status(404).json({ error: 'No matching templates found' });
        }

        const results = [];
        for (const template of templates) {
            try {
                const mockupUrl = await renderMockup({
                    designPath,
                    template,
                    workspaceId: req.workspaceId,
                    placement,
                });
                const mockup = await prisma.mockup.create({
                    data: { imageId, templateId: template.id, mockupUrl }
                });
                results.push({ templateId: template.id, templateName: template.name, status: 'OK', mockup });
            } catch (err) {
                results.push({ templateId: template.id, templateName: template.name, status: 'FAILED', error: err.message });
            }
        }

        const ok = results.filter(r => r.status === 'OK').length;
        res.json({
            message: `Rendered ${ok}/${templates.length} mockups`,
            results
        });
    } catch (err) {
        console.error('[Mockup /render-batch]', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
