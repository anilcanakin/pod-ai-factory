const { TRADEMARK_BLACKLIST } = require('../config/blacklist');

class RiskService {
    constructor() {
        this.BANNED_WORDS = TRADEMARK_BLACKLIST;
    }

    /**
     * Returns true if text contains no banned words (word-boundary match).
     * @param {string} text
     * @returns {boolean}
     */
    isSafe(text) {
        if (!text) return true;
        const str = String(text);

        for (const word of this.BANNED_WORDS) {
            // Escape regex-special chars in the word, then test with word boundaries
            const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex   = new RegExp(`\\b${escaped}\\b`, 'i');
            if (regex.test(str)) {
                console.warn(`[RiskFilter] Triggered on word: '${word}' in text: "${str.slice(0, 80)}"`);
                return false;
            }
        }
        return true;
    }

    /**
     * Checks multiple fields of an idea object.
     */
    isIdeaSafe(ideaObj) {
        const fieldsToCheck = [
            ideaObj.niche,
            ideaObj.mainKeyword,
            ideaObj.persona,
            ideaObj.hook,
            ...(ideaObj.iconFamily || []),
        ];

        for (const field of fieldsToCheck) {
            if (!this.isSafe(field)) return false;
        }
        return true;
    }
}

module.exports = new RiskService();
