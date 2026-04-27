const express = require('express');
const router = express.Router();
const agentService = require('../services/autonomous-manager.service');
const agentOrchestrator = require('../services/agent.service');

/**
 * POST /api/agent/audit
 * Triggers a manual shop audit
 */
router.post('/audit', async (req, res) => {
  try {
    const { workspaceId } = req.body;
    const plan = await agentService.runDailyAudit(workspaceId || 'default-workspace');
    res.json(plan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agent/execute-action
 * Executes an AI-recommended action via browser automation
 */
router.post('/execute-action', async (req, res) => {
  try {
    const { listingId, actionType, details } = req.body;
    const etsyBrowser = require('../services/etsy-browser.service');
    
    let result;
    if (actionType === 'UPDATE_PRICE') {
      result = await etsyBrowser.updateListing(listingId, { price: details.newPrice });
    } else if (actionType === 'UPDATE_SEO') {
      result = await etsyBrowser.updateListing(listingId, { title: details.newTitle, tags: details.newTags });
    }

    if (result?.success) {
      res.json({ success: true, message: 'Action executed successfully via Browser Agent.' });
    } else {
      res.status(500).json({ error: result?.error || 'Action failed' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Agentic Pipeline ────────────────────────────────────────────────────────

/**
 * POST /api/agent/pipeline
 * Mevcut PENDING WPI kartlarını SEO ile paketler → READY yapar.
 * Body: { forceRepackage?: boolean }
 */
router.post('/pipeline', async (req, res) => {
    try {
        const result = await agentOrchestrator.runAgentPipeline(
            req.workspaceId,
            { forceRepackage: req.body?.forceRepackage ?? false }
        );
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/agent/full-scan
 * Scout + WPI taraması + SEO paketleme (yavaş ~2-5dk).
 * Hemen başlar, background'da çalışır. Client SSE ile takip edebilir.
 */
router.post('/full-scan', async (req, res) => {
    // Hemen 202 döndür, pipeline arka planda çalışsın
    res.status(202).json({ success: true, message: 'Tam tarama başlatıldı.' });
    agentOrchestrator.triggerFullScan(req.workspaceId, { forceScout: req.body?.forceScout ?? false })
        .then(r => console.log('[Agent] Full scan tamamlandı:', JSON.stringify(r)))
        .catch(e => console.error('[Agent] Full scan hatası:', e.message));
});

/**
 * GET /api/agent/packages
 * READY paketleri listele.
 */
router.get('/packages', async (req, res) => {
    try {
        const limit    = parseInt(req.query.limit || '10', 10);
        const packages = await agentOrchestrator.listAgentPackages(req.workspaceId, limit);
        res.json({ success: true, packages, count: packages.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/agent/packages/:cardId/prepare
 * One-click: görsel üret + SEO döndür.
 */
router.post('/packages/:cardId/prepare', async (req, res) => {
    try {
        const result = await agentOrchestrator.preparePackage(req.workspaceId, req.params.cardId);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
