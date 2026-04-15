const express = require('express');
const router = express.Router();
const taskService = require('../services/task.service');

// GET /api/tasks/today
router.get('/today', async (req, res) => {
    try {
        const tasks = await taskService.getTodayTasks();
        res.json(tasks);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/tasks/initialize (Manual trigger for testing)
router.post('/initialize', async (req, res) => {
    try {
        await taskService.initializeDailyTasks();
        res.json({ message: "Daily tasks initialized." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
