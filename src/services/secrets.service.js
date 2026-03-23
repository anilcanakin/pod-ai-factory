/**
 * secrets.service.js
 *
 * Isolated API key resolution for all providers.
 * Lookup order: WorkspaceApiKey (DB) → process.env → throw
 *
 * MVP: keys stored plain text in DB.
 * To add encryption: replace get/set with encrypted versions — callers unchanged.
 */
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } }
});

const ALGORITHM = 'aes-256-gcm';
// Ensure we always have exactly 32 bytes for the key
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
    ? crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY).digest()
    : crypto.createHash('sha256').update('fallback-dev-key-do-not-use-in-prod').digest();

function encrypt(text) {
    if (!text) return text;
    if (text.startsWith('enc:')) return text;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `enc:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(text) {
    if (!text || !text.startsWith('enc:')) return text; // Backwards compatibility for plain text
    try {
        const parts = text.split(':');
        const iv = Buffer.from(parts[1], 'hex');
        const authTag = Buffer.from(parts[2], 'hex');
        const encryptedText = Buffer.from(parts[3], 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (err) {
        console.error('[Secrets Service] Decryption failed:', err.message);
        return null;
    }
}

class SecretsService {
    /**
     * Get API key for a provider.
     * @param {string} provider — "fal" | "openai" | "bg_remove" | "upscaler"
     * @param {string|null} workspaceId
     * @param {boolean} required — if true throws when not found
     */
    async getKey(provider, workspaceId = null, required = true) {
        // 1. Try workspace-scoped DB key
        if (workspaceId) {
            const row = await prisma.workspaceApiKey.findUnique({
                where: { workspaceId_provider: { workspaceId, provider } }
            });
            if (row?.keyValue) return decrypt(row.keyValue);
        }

        // 2. Fallback to process.env
        const envMap = {
            fal: process.env.FAL_API_KEY || process.env.FAL_KEY,
            openai: process.env.OPENAI_API_KEY,
            bg_remove: process.env.BG_REMOVE_API_URL,
            upscaler: process.env.UPSCALER_API_URL,
        };
        const envVal = envMap[provider];
        if (envVal && envVal.length > 5 && !envVal.startsWith('your_')) return envVal;

        // 3. Not found
        if (required) {
            throw new Error(`Missing API key for provider "${provider}". Configure it in Settings or .env.`);
        }
        return null;
    }

    /**
     * Save or update a workspace API key.
     */
    async setKey(workspaceId, provider, keyValue) {
        const encryptedValue = encrypt(keyValue);
        return prisma.workspaceApiKey.upsert({
            where: { workspaceId_provider: { workspaceId, provider } },
            update: { keyValue: encryptedValue, updatedAt: new Date() },
            create: { workspaceId, provider, keyValue: encryptedValue }
        });
    }

    /**
     * Check if a key is configured (without revealing value).
     */
    async hasKey(provider, workspaceId = null) {
        try {
            const k = await this.getKey(provider, workspaceId, false);
            return !!k;
        } catch {
            return false;
        }
    }

    /**
     * Return which providers are configured for a workspace.
     */
    async providerStatus(workspaceId = null) {
        const providers = ['fal', 'openai', 'bg_remove', 'upscaler'];
        const status = {};
        await Promise.all(providers.map(async (p) => {
            status[p] = await this.hasKey(p, workspaceId);
        }));
        return status;
    }
}

module.exports = new SecretsService();
