const { GoogleGenAI } = require('@google/genai');

// ─── Google GenAI Image Provider ─────────────────────────────────────────────
// Supports the nano-banana model family via the @google/genai SDK.
// Returns a raw Buffer + metadata — the ImageRouter is responsible for
// uploading the buffer to Supabase and normalising the final URL contract.

class GoogleGenaiProvider {
    /**
     * Lazily initialise the GenAI client.
     * Supports per-workspace key override in the future (WorkspaceApiKey table).
     */
    _getClient() {
        const apiKey = process.env.GOOGLE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (!apiKey || apiKey.startsWith('your_') || apiKey.length < 10) {
            throw new Error('GOOGLE_GEMINI_API_KEY is not configured — cannot use nano-banana provider.');
        }
        return new GoogleGenAI({ apiKey });
    }

    /**
     * Generate an image with a Google GenAI / Imagen model.
     *
     * @param {string} modelId       - e.g. 'nano-banana-2'
     * @param {{ prompt: string }}   payload
     * @param {string|null}          workspaceId  (reserved for future per-workspace key lookup)
     * @returns {{ imageBuffer: Buffer, contentType: string, seed: null, raw_response: string }}
     */
    async generateImage(modelId, payload, workspaceId = null) {
        const client = this._getClient();

        console.log(`[GoogleGenai] POST model=${modelId} | prompt="${payload.prompt.substring(0, 80)}..."`);

        const response = await client.models.generateImages({
            model: modelId,
            prompt: payload.prompt,
            config: {
                numberOfImages: 1,
                outputMimeType: 'image/png',
            },
        });

        const generated = response.generatedImages?.[0];
        if (!generated?.image?.imageBytes) {
            const raw = JSON.stringify(response).substring(0, 500);
            throw new Error(`[GoogleGenai] No image in response. Raw: ${raw}`);
        }

        const imageBuffer = Buffer.from(generated.image.imageBytes, 'base64');
        const raw_response = JSON.stringify({
            model: modelId,
            imageCount: response.generatedImages.length,
            bytesReceived: imageBuffer.length,
        });

        console.log(`[GoogleGenai] ✓ Image generated — ${imageBuffer.length} bytes`);

        return {
            imageBuffer,
            contentType: 'image/png',
            seed: null,           // Imagen does not expose a seed
            raw_response,
        };
    }
}

module.exports = new GoogleGenaiProvider();
