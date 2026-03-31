const express = require('express');
const router = express.Router();

// In-memory store: Map<workspaceId, notification[]>
// Notifications reset on server restart — use a DB table for persistence if needed.
const store = new Map();
const MAX_PER_WORKSPACE = 50;

function getLog(workspaceId) {
    if (!store.has(workspaceId)) store.set(workspaceId, []);
    return store.get(workspaceId);
}

// POST /api/notifications/log  { type, message, metadata? }
router.post('/log', (req, res) => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) return res.status(401).json({ error: 'Auth required' });

    const { type = 'info', message, metadata = {} } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });

    const log = getLog(workspaceId);
    const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, type, message, metadata, createdAt: new Date().toISOString(), read: false };
    log.unshift(entry);
    if (log.length > MAX_PER_WORKSPACE) log.length = MAX_PER_WORKSPACE;

    res.json(entry);
});

// GET /api/notifications  → last 20 entries
router.get('/', (req, res) => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) return res.status(401).json({ error: 'Auth required' });

    const log = getLog(workspaceId);
    res.json(log.slice(0, 20));
});

// POST /api/notifications/read-all  → mark all as read
router.post('/read-all', (req, res) => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) return res.status(401).json({ error: 'Auth required' });

    const log = getLog(workspaceId);
    log.forEach(e => { e.read = true; });
    res.json({ ok: true });
});

module.exports = router;

// ── Internal helper used by other routes ─────────────────────
// Usage: const { logNotification } = require('./notification.routes');
//        logNotification(workspaceId, 'success', 'Image generated', { jobId });
function logNotification(workspaceId, type, message, metadata = {}) {
    if (!workspaceId) return;
    const log = getLog(workspaceId);
    const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, type, message, metadata, createdAt: new Date().toISOString(), read: false };
    log.unshift(entry);
    if (log.length > MAX_PER_WORKSPACE) log.length = MAX_PER_WORKSPACE;
}

module.exports.logNotification = logNotification;
