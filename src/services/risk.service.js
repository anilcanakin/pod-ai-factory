class RiskService {
    constructor() {
        // A standard list of trademarked or banned words that we should not generate ideas or SEO for.
        // In a real application, this could be loaded from the DB or an external API.
        this.BANNED_WORDS = [
            'nike', 'disney', 'marvel', 'star wars', 'gucci', 'louis vuitton',
            'chanel', 'prada', 'mickey', 'minnie', 'avengers', 'harry potter',
            'hogwarts', 'jedi', 'sith', 'pokemon', 'pikachu', 'nintendo',
            'playstation', 'xbox', 'rolex', 'supreme'
        ];
    }

    /**
     * Checks a string against the banned words list.
     * @param {string} text - The text to check.
     * @returns {boolean} - Returns true if the text is safe (no banned words found), false otherwise.
     */
    isSafe(text) {
        if (!text) return true;
        const normalizedText = String(text).toLowerCase();

        for (const word of this.BANNED_WORDS) {
            // Using a simple includes check. For more robustness, regex word boundaries could be used.
            if (normalizedText.includes(word)) {
                console.warn(`[RiskFilter] Triggered on word: '${word}' in text: "${text}"`);
                return false; // Not safe
            }
        }
        return true; // Safe
    }

    /**
     * Helper to check multiple fields of an object.
     */
    isIdeaSafe(ideaObj) {
        const fieldsToCheck = [
            ideaObj.niche,
            ideaObj.mainKeyword,
            ideaObj.persona,
            ideaObj.hook,
            ...(ideaObj.iconFamily || [])
        ];

        for (const field of fieldsToCheck) {
            if (!this.isSafe(field)) {
                return false;
            }
        }
        return true;
    }
}

module.exports = new RiskService();
