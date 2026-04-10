const express = require('express');
const router = express.Router();
const radarService = require('../services/competitor-radar.service');

/**
 * POST /api/radar/scan
 * Scans a competitor shop URL
 */
router.post('/scan', async (req, res) => {
  try {
    const { shopUrl } = req.body;
    const result = await radarService.scanCompetitor(shopUrl);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
