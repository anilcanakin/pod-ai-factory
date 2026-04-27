const express = require('express');
const router  = express.Router();
const {
    listProfiles, getProfile, createProfile, updateProfile,
    deleteProfile, setDefault, createFromLockedDNA,
} = require('../services/style.service');

/**
 * GET /api/styles
 * Workspace'e ait tüm StyleProfile kayıtlarını listele.
 */
router.get('/', async (req, res) => {
    try {
        const profiles = await listProfiles(req.workspaceId);
        res.json({ success: true, profiles });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/styles
 * Yeni StyleProfile oluştur.
 * Body: { name, emoji?, baseModel?, promptPrefix?, promptSuffix?,
 *         negativePrompt?, referenceImageUrl?, colorPalette? }
 */
router.post('/', async (req, res) => {
    try {
        const { name, emoji, baseModel, promptPrefix, promptSuffix,
                negativePrompt, referenceImageUrl, colorPalette } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: 'name gerekli' });

        const profile = await createProfile(req.workspaceId, {
            name: name.trim(),
            emoji:          emoji            || '🎨',
            baseModel:      baseModel        || 'fal-ai/flux/schnell',
            promptPrefix:   promptPrefix     || null,
            promptSuffix:   promptSuffix     || null,
            negativePrompt: negativePrompt   || null,
            referenceImageUrl: referenceImageUrl || null,
            colorPalette:   colorPalette     || null,
        });

        res.json({ success: true, profile });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/styles/:id
 */
router.get('/:id', async (req, res) => {
    try {
        const profile = await getProfile(req.params.id, req.workspaceId);
        if (!profile) return res.status(404).json({ error: 'Profil bulunamadı' });
        res.json({ success: true, profile });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * PATCH /api/styles/:id
 * Kısmi güncelleme.
 */
router.patch('/:id', async (req, res) => {
    try {
        const allowed = ['name', 'emoji', 'baseModel', 'promptPrefix', 'promptSuffix',
                         'negativePrompt', 'referenceImageUrl', 'colorPalette'];
        const data = {};
        for (const k of allowed) {
            if (k in req.body) data[k] = req.body[k];
        }
        const profile = await updateProfile(req.params.id, req.workspaceId, data);
        res.json({ success: true, profile });
    } catch (err) {
        res.status(err.message === 'Profil bulunamadı' ? 404 : 500).json({ error: err.message });
    }
});

/**
 * DELETE /api/styles/:id
 */
router.delete('/:id', async (req, res) => {
    try {
        await deleteProfile(req.params.id, req.workspaceId);
        res.json({ success: true });
    } catch (err) {
        res.status(err.message === 'Profil bulunamadı' ? 404 : 500).json({ error: err.message });
    }
});

/**
 * POST /api/styles/:id/set-default
 * Bu profili workspace varsayılanı yap.
 */
router.post('/:id/set-default', async (req, res) => {
    try {
        const profile = await setDefault(req.params.id, req.workspaceId);
        res.json({ success: true, profile });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/styles/from-locked-dna
 * "Stile Kilitle" butonundan gelen lockedDNA objesini DB'ye kaydeder.
 * Body: { sourceTitle, modelKey, stylePresetId?, seed?, designBrief }
 */
router.post('/from-locked-dna', async (req, res) => {
    try {
        const { sourceTitle, modelKey, stylePresetId, seed, designBrief } = req.body;
        if (!modelKey) return res.status(400).json({ error: 'modelKey gerekli' });

        const profile = await createFromLockedDNA(req.workspaceId, {
            sourceTitle, modelKey, stylePresetId, seed, designBrief,
        });
        res.json({ success: true, profile });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
