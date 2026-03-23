const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const DEV_TOKEN = 'dev-token-2024';

function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').substring(0, 30);
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });

    try {
        // Find or create user
        let user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            user = await prisma.user.create({ data: { email } });
        }

        // Find or create workspace for this user
        let membership = await prisma.workspaceMember.findFirst({
            where: { userId: user.id },
            include: { workspace: true }
        });

        if (!membership) {
            const slug = slugify(email.split('@')[0]) + '-' + user.id.substring(0, 6);
            const workspace = await prisma.workspace.create({
                data: {
                    name: email.split('@')[0],
                    slug,
                    members: { create: { userId: user.id, role: 'owner' } }
                }
            });
            membership = { workspace };
        }

        const workspaceId = membership.workspace.id;

        // Set cookie: "workspaceId:userId" (dev MVP — replace with signed JWT in prod)
        const token = `${workspaceId}:${user.id}`;
        res.cookie('auth_token', token, {
            httpOnly: true,
            path: '/',
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        res.json({ ok: true, workspaceId, userId: user.id, email });
    } catch (err) {
        console.error('[Auth/login]', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
    res.cookie('auth_token', '', { maxAge: 0, httpOnly: true, path: '/' });
    res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
    console.log('[Auth/me] cookies:', req.cookies);
    console.log('[Auth/me] headers.cookie:', req.headers.cookie);
    let token = req.cookies?.['auth_token'] || req.headers['x-auth-token'];

    // Fallback: manually parse if cookie-parser missed it due to formatting
    if (!token && req.headers.cookie) {
        const match = req.headers.cookie.match(/auth_token=([^;]+)/);
        if (match) token = match[1];
    }

    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    // Handle legacy dev token
    if (token === DEV_TOKEN) {
        return res.json({
            user: { id: 'dev', email: 'dev@local', role: 'owner' },
            workspace: { id: null }
        });
    }

    const decodedToken = decodeURIComponent(token);
    const parts = decodedToken.split(':');
    if (parts.length < 2) return res.status(401).json({ error: 'Invalid token' });

    const [workspaceId, userId] = parts;
    try {
        const membership = await prisma.workspaceMember.findFirst({
            where: { userId, workspaceId },
            include: { user: true, workspace: true }
        });
        if (!membership) return res.status(401).json({ error: 'Session expired' });

        res.json({
            user: { id: userId, email: membership.user.email, role: membership.role },
            workspace: { id: workspaceId, name: membership.workspace.name }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
