const express = require('express');
const router = express.Router();
const agentService = require('../services/autonomous-manager.service');

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

module.exports = router;
