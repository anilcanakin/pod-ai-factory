const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const Anthropic = require('@anthropic-ai/sdk');

// ─── GET /api/trends/weekly — AI-analysed weekly trending niches ─────────────
router.get('/weekly', async (req, res) => {
    try {
        const { getRelevantContext } = require('../services/knowledge-context.service');
        const brainContext = await getRelevantContext(req.workspaceId || 'default-workspace', 'ideas');

        // 1. Fetch Etsy autocomplete for trending terms
        const trendingSeeds = [
            'shirt 2026', 'funny shirt', 'gift shirt', 'vintage shirt',
            'patriotic shirt', 'mom shirt', 'dad shirt', 'dog shirt',
            'cat shirt', 'nature shirt', 'motivational shirt'
        ];

        const etsySuggestions = await Promise.allSettled(
            trendingSeeds.slice(0, 5).map(async seed => {
                const encoded = encodeURIComponent(seed);
                const url = `https://www.etsy.com/api/v3/ajax/suggest/search-suggestions?q=${encoded}&context=listing_search`;
                const response = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json',
                        'Referer': 'https://www.etsy.com/',
                        'x-detected-locale': 'USD|en-US|US'
                    },
                    timeout: 8000
                });
                if (!response.ok) return [];
                const data = await response.json();
                return data?.results?.map(r => r.query || r.search_query) || [];
            })
        );

        const allSuggestions = etsySuggestions
            .filter(r => r.status === 'fulfilled')
            .flatMap(r => r.value)
            .filter(Boolean);

        // 2. Get seasonal context
        const now = new Date();
        const month = now.getMonth() + 1;
        const seasonalContext = getSeasonalContext(month);

        // 3. Use AI to analyse and rank trends
        const client = new Anthropic();
        const response = await client.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 2000,
            system: `You are an expert Etsy POD trend analyst.
Your job is to identify the most profitable niches for print-on-demand sellers RIGHT NOW.${brainContext ? `\n\nBusiness Knowledge:\n${brainContext}` : ''}`,
            messages: [{
                role: 'user',
                content: `Analyze these real Etsy search suggestions and seasonal context to identify top trending niches.

REAL ETSY SEARCHES RIGHT NOW:
${allSuggestions.slice(0, 30).join(', ') || '(no live data — use seasonal context)'}

SEASONAL CONTEXT (Month ${month}):
${seasonalContext}

Return ONLY valid JSON:
{
  "hotNiches": [
    {
      "niche": "Patriotic Eagle",
      "reason": "4th of July approaching, high search volume",
      "keywords": ["patriotic eagle shirt", "american eagle tee", "freedom shirt"],
      "urgency": "high",
      "competition": "medium",
      "estimatedDemand": "very high"
    }
  ],
  "upcomingOpportunities": [
    {
      "niche": "Back to School",
      "timeframe": "Start now, peak in August",
      "keywords": ["teacher shirt", "student tee"],
      "daysUntilPeak": 45
    }
  ],
  "avoidNow": [
    {
      "niche": "Christmas",
      "reason": "Too early, competition will be low but demand isn't there yet"
    }
  ],
  "weeklyFocus": "Focus on patriotic and summer themes this week"
}`
            }]
        });

        const rawText = response.content[0].text.replace(/```json|```/g, '').trim();
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('AI yanıtında JSON bulunamadı');
        const trends = JSON.parse(jsonMatch[0]);

        res.json({
            ...trends,
            generatedAt: new Date().toISOString(),
            etsySuggestionsCount: allSuggestions.length,
            month: now.toLocaleString('en-US', { month: 'long' })
        });

    } catch (err) {
        console.error('[Trends Weekly]', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /api/trends/seasonal — full year calendar ────────────────────────────
router.get('/seasonal', async (req, res) => {
    try {
        res.json(getFullSeasonalCalendar());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSeasonalContext(month) {
    const contexts = {
        1:  "January: New Year resolutions, winter clearance, Valentine's prep starts",
        2:  "February: Valentine's Day PEAK, Galentine's, love themes, winter",
        3:  "March: St. Patrick's Day, Spring begins, Easter prep, Women's Day",
        4:  "April: Easter PEAK, Spring themes, Earth Day, Mother's Day prep",
        5:  "May: Mother's Day PEAK, Memorial Day, graduation season starts",
        6:  "June: Father's Day PEAK, graduation, Pride Month, summer begins",
        7:  "July: 4th of July PEAK, patriotic themes, summer vacation, beach",
        8:  "August: Back to School PEAK, teacher gifts, summer wind-down",
        9:  "September: Fall begins, Halloween prep starts, football season",
        10: "October: Halloween PEAK, fall themes, Thanksgiving prep",
        11: "November: Thanksgiving PEAK, Veterans Day, Black Friday, Christmas prep STARTS",
        12: "December: Christmas PEAK, Hanukkah, New Year prep, winter themes"
    };
    return contexts[month] || "General shopping season";
}

function getFullSeasonalCalendar() {
    return [
        { month: "January",   events: ["New Year", "Winter Sales"],                          niches: ["Resolutions", "Fitness", "Winter"],                    urgency: "low" },
        { month: "February",  events: ["Valentine's Day (14)", "Galentine's (13)"],           niches: ["Love", "Romance", "Couples", "Friendship"],            urgency: "very high" },
        { month: "March",     events: ["St. Patrick's (17)", "Spring Equinox", "Women's Day (8)"], niches: ["Irish", "Luck", "Spring", "Women Empowerment"],  urgency: "high" },
        { month: "April",     events: ["Easter", "Earth Day (22)"],                           niches: ["Easter", "Spring", "Nature", "Garden"],               urgency: "high" },
        { month: "May",       events: ["Mother's Day (2nd Sun)", "Memorial Day"],             niches: ["Mom Gifts", "Military", "Patriotic", "Graduation"],    urgency: "very high" },
        { month: "June",      events: ["Father's Day (3rd Sun)", "Pride Month", "Graduation"], niches: ["Dad Gifts", "Pride", "Graduate", "Summer"],          urgency: "very high" },
        { month: "July",      events: ["4th of July", "Summer Peak"],                         niches: ["Patriotic", "American", "Freedom", "Summer"],         urgency: "very high" },
        { month: "August",    events: ["Back to School", "Summer End"],                       niches: ["Teacher", "Student", "School", "Fall Prep"],          urgency: "high" },
        { month: "September", events: ["Labor Day", "Fall Begins", "Football"],               niches: ["Fall", "Football", "Halloween Prep", "Autumn"],       urgency: "medium" },
        { month: "October",   events: ["Halloween (31)", "Breast Cancer Awareness"],          niches: ["Halloween", "Spooky", "Fall", "Awareness"],           urgency: "very high" },
        { month: "November",  events: ["Thanksgiving", "Veterans Day (11)", "Black Friday"],  niches: ["Thanksgiving", "Veterans", "Gratitude", "Christmas Prep"], urgency: "very high" },
        { month: "December",  events: ["Christmas (25)", "Hanukkah", "New Year's Eve"],       niches: ["Christmas", "Holiday", "Winter", "New Year"],         urgency: "very high" }
    ];
}

module.exports = router;
