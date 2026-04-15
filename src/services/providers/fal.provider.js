const fetch = require('node-fetch');
const secretsService = require('../secrets.service');

// ─── Size mapping: UI values → fal accepted enum ──────────────
const FAL_SIZE_MAP = {
    'square_hd':      'square_hd',
    'square':         'square',
    'portrait_4_3':   'portrait_4_3',
    'portrait_16_9':  'portrait_16_9',
    'landscape_4_3':  'landscape_4_3',
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
     * Generate an image via fal.ai endpoints.
     * Auth: `Authorization: Key <FAL_API_KEY>` — per fal.ai official docs.
     * @param {string}      modelId
     * @param {Object}      payload      — the dynamically built payload
     * @param {string|null} workspaceId  — for workspace-scoped key lookup
     * @returns {{ image_url, seed, raw_response }}
     */
    async generateImage(modelId, payload, workspaceId = null) {
        const falKey = await secretsService.getKey('fal', workspaceId, true);

        const model = modelId || 'fal-ai/flux/dev';
        const url   = `https://fal.run/${model}`;

        const headers = {
            'Authorization': `Key ${falKey}`,
            'Content-Type':  'application/json',
        };

        console.log(`[Fal] POST ${url} | Payload keys: ${Object.keys(payload)}...`);

        const maxRetries = 3;
        let lastErr;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const controller = new AbortController();
                const timeout    = setTimeout(() => controller.abort(), 60000); // 60s per image

                const response = await fetch(url, {
                    method:  'POST',
                    headers,
                    body:    JSON.stringify(payload),
                    signal:  controller.signal,
                });
                clearTimeout(timeout);

                const responseText = await response.text();
                let data = {};
                try { data = JSON.parse(responseText); } catch { data = { _raw: responseText }; }

                if (!response.ok) {
                    const errMsg = data.detail || data.message || data.error || responseText;
                    const err    = new Error(`Fal HTTP ${response.status}: ${errMsg}`);
                    err.status      = response.status;
                    err.rawResponse = `HTTP ${response.status} — ${responseText.substring(0, 500)}`;

                    if (response.status === 401 || response.status === 403) throw err;
                    if (response.status === 422) {
                        console.error(`[Fal] 422 Unprocessable — payload: ${JSON.stringify(payload)}`);
                        throw err;
                    }
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
                    data.image?.url       ||
                    data.output?.[0]?.url ||
                    null;

                if (!imageUrl) {
                    const err       = new Error('Fal returned OK but no image URL in response');
                    err.rawResponse = responseText.substring(0, 500);
                    throw err;
                }

                console.log(`[Fal] ✓ image generated: ${imageUrl.substring(0, 80)}`);
                return {
                    image_url:    imageUrl,
                    seed:         data.seed != null ? String(data.seed) : null,
                    raw_response: responseText.substring(0, 2000),
                };

            } catch (err) {
                if (err.name === 'AbortError') {
                    err.message     = 'Fal request timed out (60s)';
                    err.rawResponse = 'TIMEOUT';
                }
                if (!lastErr || attempt === maxRetries - 1) throw err;
            }
        }

        throw lastErr;
    }

    /**
     * Arka planı kaldır — BiRefNet (ücretsiz, yüksek kalite, şeffaf PNG çıktısı).
     * @param {string}      imageUrl    — kaynak görsel URL'si (FAL CDN veya Supabase)
     * @param {string|null} workspaceId
     * @returns {{ image_url: string, cost: number }}
     */
    async removeBackground(imageUrl, workspaceId = null) {
        const falKey = await secretsService.getKey('fal', workspaceId, true);

        const RMBG_MODEL = 'fal-ai/birefnet';
        const RMBG_COST  = 0.000; // BiRefNet ücretsizdir
        const url        = `https://fal.run/${RMBG_MODEL}`;

        const headers = {
            'Authorization': `Key ${falKey}`,
            'Content-Type':  'application/json',
        };
        const payload = {
            image_url:            imageUrl,
            model:                'General Use (Light)',
            operating_resolution: '1024x1024',
            output_format:        'png',
        };

        console.log(`[Fal/RMBG] POST ${url} | kaynak: ${imageUrl.substring(0, 70)}...`);

        const controller = new AbortController();
        const timeout    = setTimeout(() => controller.abort(), 120000); // 2 dk

        const response = await fetch(url, {
            method:  'POST',
            headers,
            body:    JSON.stringify(payload),
            signal:  controller.signal,
        });
        clearTimeout(timeout);

        const responseText = await response.text();
        let data = {};
        try { data = JSON.parse(responseText); } catch { data = { _raw: responseText }; }

        if (!response.ok) {
            const errMsg    = data.detail || data.message || data.error || responseText;
            const err       = new Error(`BiRefNet HTTP ${response.status}: ${errMsg}`);
            err.rawResponse = `HTTP ${response.status} — ${responseText.substring(0, 500)}`;
            throw err;
        }

        const outputUrl =
            data.image?.url        ||
            data.images?.[0]?.url  ||
            data.output?.[0]?.url  ||
            null;

        if (!outputUrl) {
            const err       = new Error('BiRefNet returned OK but no image URL in response');
            err.rawResponse = responseText.substring(0, 500);
            throw err;
        }

        console.log(`[Fal/RMBG] ✓ Arka plan silindi: ${outputUrl.substring(0, 80)}`);
        return { image_url: outputUrl, cost: RMBG_COST };
    }

    /**
     * Görsel çözünürlüğünü yükselt (Upscale).
     * @param {string}      imageUrl    — kaynak görsel URL'si
     * @param {number}      scale       — büyütme oranı (2, 4)
     * @param {string|null} workspaceId
     * @returns {{ image_url: string, cost: number }}
     */
    async upscaleImage(imageUrl, scale = 4, workspaceId = null) {
        const falKey = await secretsService.getKey('fal', workspaceId, true);

        const UPSCALE_MODEL = 'fal-ai/aura-sr';
        const UPSCALE_COST  = 0.001; // Aura-SR yaklaşık maliyeti
        const url           = `https://fal.run/${UPSCALE_MODEL}`;

        const headers = {
            'Authorization': `Key ${falKey}`,
            'Content-Type':  'application/json',
        };
        const payload = {
            image_url: imageUrl,
            // aura-sr için scale parametresi bazen model versiyonuna göre değişebilir
            // ama genellikle girdi çözünürlüğünü otomatik yükseltir.
        };

        console.log(`[Fal/Upscale] POST ${url} | kaynak: ${imageUrl.substring(0, 70)}...`);

        const controller = new AbortController();
        const timeout    = setTimeout(() => controller.abort(), 120000); // 2 dk

        const response = await fetch(url, {
            method:  'POST',
            headers,
            body:    JSON.stringify(payload),
            signal:  controller.signal,
        });
        clearTimeout(timeout);

        const responseText = await response.text();
        let data = {};
        try { data = JSON.parse(responseText); } catch { data = { _raw: responseText }; }

        if (!response.ok) {
            const errMsg    = data.detail || data.message || data.error || responseText;
            const err       = new Error(`Upscale HTTP ${response.status}: ${errMsg}`);
            err.rawResponse = `HTTP ${response.status} — ${responseText.substring(0, 500)}`;
            throw err;
        }

        const outputUrl =
            data.image?.url        ||
            data.images?.[0]?.url  ||
            data.output?.[0]?.url  ||
            null;

        if (!outputUrl) {
            const err       = new Error('Upscale returned OK but no image URL in response');
            err.rawResponse = responseText.substring(0, 500);
            throw err;
        }

        console.log(`[Fal/Upscale] ✓ Çözünürlük yükseltildi: ${outputUrl.substring(0, 80)}`);
        return { image_url: outputUrl, cost: UPSCALE_COST };
    }
}

module.exports = new FalProvider();
