/**
 * workspace.middleware.js
 *
 * Extracts workspaceId from cookie and attaches it to req.workspaceId.
 * Backward compatible: legacy 'dev-token-2024' cookie → workspaceId = null.
 */

const DEV_TOKEN = 'dev-token-2024';

function workspaceMiddleware(req, res, next) {
    const rawCookie = req.headers.cookie || '';
    const match = rawCookie.match(/auth_token=([^;]+)/);
    const token = match ? decodeURIComponent(match[1]) : null;

    if (!token) {
        req.workspaceId = null;
        req.userId = null;
        return next();
    }

    // Legacy dev token
    if (token === DEV_TOKEN) {
        req.workspaceId = null;
        req.userId = 'dev';
        return next();
    }

    // Real token: "workspaceId:userId"
    const parts = token.split(':');
    if (parts.length >= 2) {
        req.workspaceId = parts[0];
        req.userId = parts[1];
    } else {
        req.workspaceId = null;
        req.userId = null;
    }

    next();
}

module.exports = workspaceMiddleware;
