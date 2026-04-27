/**
 * style-manager.service.js — Style Consistency (Stil Tutarlılığı)
 *
 * Her preset: sabit prompt parçası + renk paleti + tercih edilen model.
 * applyStylePreset() → prompt'a preset'in promptFragment'ini ekler.
 * inheritDNA()        → bir "winner" görsel'in genetiğini sonraki üretime aktarır.
 */

// ─── Preset Tanımları ─────────────────────────────────────────────────────────

const STYLE_PRESETS = {
    vintage_90s: {
        id:             'vintage_90s',
        label:          'Vintage 90s',
        emoji:          '📼',
        promptFragment: 'vintage 90s aesthetic, retro typography, faded worn textures, warm earthy tones, grunge distressed effects, nostalgic feel, analog print',
        colorPalette: [
            { name: 'Rust Orange',  hex: '#C4622D' },
            { name: 'Faded Denim',  hex: '#4A6FA5' },
            { name: 'Cream',        hex: '#F5E6C8' },
            { name: 'Forest Green', hex: '#3A5A40' },
        ],
        preferredModelKey: 'PREMIUM_SD',
        styleGuide:        'retro, vintage, worn textures, nostalgic color palette',
    },

    minimalist_vector: {
        id:             'minimalist_vector',
        label:          'Minimalist Vector',
        emoji:          '⚡',
        promptFragment: 'clean minimalist vector illustration, geometric shapes, bold simple lines, flat design, high contrast, no gradients, pure white background, print-ready SVG style',
        colorPalette: [
            { name: 'Jet Black',   hex: '#1A1A2E' },
            { name: 'Pure White',  hex: '#FFFFFF' },
            { name: 'Navy Blue',   hex: '#0F3460' },
            { name: 'Accent Red',  hex: '#E94560' },
        ],
        preferredModelKey: 'PREMIUM_SD',
        styleGuide:        'minimalist, vector, clean, flat, high-contrast',
    },

    boho_aesthetic: {
        id:             'boho_aesthetic',
        label:          'Boho Aesthetic',
        emoji:          '🌿',
        promptFragment: 'bohemian aesthetic, hand-drawn organic shapes, earth tones, wildflowers, feathers, crystals, spiritual motifs, free-spirited artistic style, natural textures',
        colorPalette: [
            { name: 'Terracotta', hex: '#B85C38' },
            { name: 'Sage Green', hex: '#7A9E7E' },
            { name: 'Sand',       hex: '#E8D5B7' },
            { name: 'Dusty Rose', hex: '#C4A0A0' },
        ],
        preferredModelKey: 'PREMIUM_GOOGLE',
        styleGuide:        'boho, organic, earthy, hand-drawn, spiritual',
    },

    bold_statement: {
        id:             'bold_statement',
        label:          'Bold Statement',
        emoji:          '💥',
        promptFragment: 'bold impactful typography, high contrast colors, strong graphic design, statement art, powerful visual hierarchy, oversized text elements, striking composition',
        colorPalette: [
            { name: 'Neon Yellow', hex: '#FFE600' },
            { name: 'Deep Black',  hex: '#0D0D0D' },
            { name: 'Hot Pink',    hex: '#FF2D8A' },
            { name: 'White',       hex: '#F8F8F8' },
        ],
        preferredModelKey: 'PREMIUM_OPENAI',
        styleGuide:        'bold, high-contrast, statement, powerful, typography-driven',
    },

    retro_typography: {
        id:             'retro_typography',
        label:          'Retro Typography',
        emoji:          '🖋',
        promptFragment: 'vintage sign painting style, retro serif typography, old-school lettering, hand-painted look, aged paper texture, classic Americana design, badge style',
        colorPalette: [
            { name: 'Burgundy', hex: '#6B2D3E' },
            { name: 'Old Gold', hex: '#C9A84C' },
            { name: 'Ivory',    hex: '#F0EAD6' },
            { name: 'Charcoal', hex: '#2C2C2C' },
        ],
        preferredModelKey: 'PREMIUM_GOOGLE',
        styleGuide:        'retro typography, vintage signage, hand-lettered, Americana',
    },

    fun_kawaii: {
        id:             'fun_kawaii',
        label:          'Fun Kawaii',
        emoji:          '🌸',
        promptFragment: 'kawaii cute style, pastel colors, adorable chibi characters, rounded shapes, big expressive eyes, playful cheerful, Japanese cute aesthetic, soft illustration',
        colorPalette: [
            { name: 'Bubblegum', hex: '#FFB7C5' },
            { name: 'Lavender',  hex: '#D8B4FE' },
            { name: 'Mint',      hex: '#A7F3D0' },
            { name: 'Peach',     hex: '#FECBA1' },
        ],
        preferredModelKey: 'PREMIUM_GOOGLE',
        styleGuide:        'kawaii, cute, pastel, playful, adorable',
    },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Verilen prompt'a preset'in promptFragment'ini ekler.
 * Preset bulunamazsa orijinal prompt döner.
 */
function applyStylePreset(basePrompt, presetId) {
    const preset = STYLE_PRESETS[presetId];
    if (!preset) return basePrompt;
    return `${basePrompt}, ${preset.promptFragment}`;
}

/**
 * Bir "winner" görselin genetiğini (prompt, model, seed, preset) sonraki
 * üretim için hazır bir DNA objesi olarak döner.
 */
function inheritDNA({ basePrompt, modelKey, seed, stylePresetId }) {
    return {
        basePrompt,
        modelKey:      modelKey      || 'PREMIUM_GOOGLE',
        seed:          seed          || null,
        stylePresetId: stylePresetId || null,
        lockedAt:      new Date().toISOString(),
    };
}

function getStylePreset(presetId) {
    return STYLE_PRESETS[presetId] || null;
}

function getAllPresets() {
    return Object.values(STYLE_PRESETS);
}

module.exports = { STYLE_PRESETS, applyStylePreset, inheritDNA, getStylePreset, getAllPresets };
