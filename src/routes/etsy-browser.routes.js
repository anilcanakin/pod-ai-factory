const express = require('express');
const router = express.Router();

// POST /api/etsy-browser/create-draft
router.post('/create-draft', async (req, res) => {
    try {
        const { title, description, tags, price, imageUrls } = req.body;
        if (!title || !description || !tags) {
            return res.status(400).json({ error: 'title, description, tags required' });
        }

        const { createEtsyDraft } = require('../services/etsy-browser.service');
        const result = await createEtsyDraft({ title, description, tags, price, imageUrls });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/etsy-browser/scrape
router.post('/scrape', async (req, res) => {
    try {
        const { scrapeListings } = require('../services/etsy-browser.service');
        const result = await scrapeListings();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/etsy-browser/pin-pinterest
router.post('/pin-pinterest', async (req, res) => {
    try {
        const { imageUrl, title, description, link } = req.body;
        if (!imageUrl || !title) {
            return res.status(400).json({ error: 'imageUrl and title required' });
        }

        const { pinToPinterest } = require('../services/etsy-browser.service');
        const result = await pinToPinterest({ imageUrl, title, description, link });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
