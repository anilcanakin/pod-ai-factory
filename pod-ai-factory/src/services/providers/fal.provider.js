const fetch = require('node-fetch');
const secretsService = require('../secrets.service');

// ─── Size mapping: UI values → fal accepted enum ──────────────
const FAL_SIZE_MAP = {
    'square_hd': 'square_hd',
    'square': 'square',
    'portrait_4_3': 'portrait_4_3',
    'portrait_16_9': 'portrait_16_9',
    'landscape_4_3': 'landscape_4_3',
    'landscape_16_9': 'landscape_16_9',
    // Legacy UI strings
    '1024x1024': 'square_hd',
    '1024x1536': 'portrait_4_3',
    '1536x1024': 'landscape_4_3',
};

function mapSize(uiSize) {
    return FAL_SIZE_MAP[uiSize] || 'square_hd';
}

class FalProvider {
    /**
     * Generate an image via fal.ai Flux endpoint.
     * Auth: `Authorization: Key <FAL_API_KEY>` — per fal.ai official docs.
     * Payload fields: prompt, image_size, num_images, seed (optional)
     * @param {string} prompt
     * @param {string} size  — UI size string, mapped to fal enum
     * @param {number} numImages
     * @param {number|null} seed
     * @param {string|null} workspaceId  — for workspace-scoped key lookup
     * @returns {{ image_url, seed, raw_response, cost }}
     */
    async generateImage(prompt, size = 'square_hd', numImages = 1, seed, workspaceId = null) {
        const falKey = await secretsService.getKey('fal', workspaceId, true);

        const model = process.env.FAL_MODEL || 'fal-ai/flux/dev';
        const url = `https://fal.run/${model}`;
        const imageSize = mapSize(size);

        // Payload: only send fields that fal.ai's flux/dev model accepts
        const payload = {
            prompt: prompt.substring(0, 1000),
            image_size: imageSize,
            num_images: numImages,
        };
        if (seed != null) payload.seed = seed;

        // Auth header: official fal.ai format is "Key <token>"
        const headers = {
            'Authorization': `Key ${falKey}`,
            'Content-Type': 'application/json',
        };

        console.log(`[Fal] POST ${url} | image_size=${imageSize} | prompt=${prompt.substring(0, 80)}…`);

        const maxRetries = 3;
        let lastErr;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 60000); // 60s per image

                const response = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload),
                    signal: controller.signal,
                });
                clearTimeout(timeout);

                const responseText = await response.text();
                let data = {};
                try { data = JSON.parse(responseText); } catch { data = { _raw: responseText }; }

                if (!response.ok) {
                    const errMsg = data.detail || data.message || data.error || responseText;
                    const err = new Error(`Fal HTTP ${response.status}: ${errMsg}`);
                    err.status = response.status;
                    err.rawResponse = `HTTP ${response.status} — ${responseText.substring(0, 500)}`;

                    // Handle 401/403: no retry — key issue
                    if (response.status === 401 || response.status === 403) throw err;
                    // Handle 422: log payload and throw — bad payload, no retry
                    if (response.status === 422) {
                        console.error(`[Fal] 422 Unprocessable — payload: ${JSON.stringify(payload)}`);
                        throw err;
                    }
                    // 429: backoff and retry
                    if (response.status === 429 && attempt < maxRetries - 1) {
                        const backoff = Math.pow(2, attempt) * 1500;
                        console.warn(`[Fal] 429 Rate limit. Retrying in ${backoff}ms… (attempt ${attempt + 1})`);
                        await new Promise(r => setTimeout(r, backoff));
                        lastErr = err;
                        continue;
                    }
                    throw err;
                }

                // Extract image URL — fal returns images[].url
                const imageUrl =
                    data.images?.[0]?.url ||
                    data.image?.url ||
                    data.output?.[0]?.url ||
                    null;

                if (!imageUrl) {
                    const err = new Error('Fal returned OK but no image URL in response');
                    err.rawResponse = responseText.substring(0, 500);
                    throw err;
                }

                console.log(`[Fal] ✓ image generated: ${imageUrl.substring(0, 80)}`);
                return {
                    image_url: imageUrl,
                    seed: data.seed != null ? String(data.seed) : null,
                    raw_response: responseText.substring(0, 2000),
                };

            } catch (err) {
                if (err.name === 'AbortError') {
                    err.message = 'Fal request timed out (60s)';
                    err.rawResponse = 'TIMEOUT';
                }
                // If not a 429-retry scenario, re-throw immediately
                if (!lastErr || attempt === maxRetries - 1) throw err;
            }
        }

        throw lastErr;
    }
}

module.exports = new FalProvider();
