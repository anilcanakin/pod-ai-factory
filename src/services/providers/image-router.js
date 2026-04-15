const falProvider         = require('./fal.provider');
const googleGenaiProvider = require('./google-genai.provider');

// ─── Multi-Provider Image Router ─────────────────────────────────────────────
//
// Single entry point for ALL image generation regardless of provider.
//
// CONTRACT (always returned):
//   { image_url: string, seed: string|null, raw_response: string }
//
// Downstream consumers (VisionQA, BiRefNet RMBG, Supabase upload) never know
// which provider was used — they always receive a real HTTPS URL.
//
// ┌─────────────────┬───────────────────────────────────────────────────┐
// │ Provider        │ How image_url is produced                         │
// ├─────────────────┼───────────────────────────────────────────────────┤
// │ FAL.ai          │ CDN URL returned directly by FAL                  │
// │ Google GenAI    │ Buffer uploaded to Supabase temp path → public URL│
// └─────────────────┴───────────────────────────────────────────────────┘

// Model IDs that belong to the Google GenAI provider (not FAL endpoints)
const GENAI_MODEL_PREFIX = 'nano-banana';

function isGenaiModel(modelId) {
    return typeof modelId === 'string' && modelId.startsWith(GENAI_MODEL_PREFIX);
}

class ImageRouter {
    /**
     * Route image generation to the correct provider and normalise the response.
     *
     * @param {string}      modelId     - Resolved model ID (e.g. 'nano-banana', 'fal-ai/flux/dev')
     * @param {Object}      payload     - Generation payload built by buildModelInput()
     * @param {string|null} workspaceId
     * @returns {Promise<{ image_url: string, seed: string|null, raw_response: string }>}
     */
    async generate(modelId, payload, workspaceId = null) {
        if (isGenaiModel(modelId)) {
            return this._routeToGenai(modelId, payload, workspaceId);
        }
        // Default path — FAL.ai (Flux, Ideogram, Recraft, Schnell …)
        return falProvider.generateImage(modelId, payload, workspaceId);
    }

    // ── Private: Google GenAI path ───────────────────────────────────────────
    async _routeToGenai(modelId, payload, workspaceId) {
        // Step 1 — Generate: receive raw PNG Buffer from Genai
        const genaiResult = await googleGenaiProvider.generateImage(modelId, payload, workspaceId);

        // Step 2 — Stage: upload Buffer to Supabase so QA + RMBG can use a real HTTPS URL
        //   Path: temp_genai/<timestamp>_<random>.png
        //   This is a staging slot; the Generation pipeline will overwrite with the final path.
        const { uploadBufferToStorage } = require('../storage.service');
        const stagingPath = `temp_genai/${Date.now()}_${Math.random().toString(36).slice(2, 9)}.png`;

        let imageUrl;
        try {
            imageUrl = await uploadBufferToStorage(
                genaiResult.imageBuffer,
                stagingPath,
                genaiResult.contentType
            );
            console.log(`[ImageRouter] Genai image staged → ${imageUrl.substring(0, 80)}...`);
        } catch (uploadErr) {
            // If Supabase staging fails, wrap buffer as data URL so QA can still run.
            // RMBG (BiRefNet) will also fail on a data URL — throw to surface the real error.
            throw new Error(`[ImageRouter] Genai staging upload failed: ${uploadErr.message}`);
        }

        return {
            image_url:    imageUrl,
            seed:         genaiResult.seed,
            raw_response: genaiResult.raw_response,
        };
    }
}

module.exports = new ImageRouter();
