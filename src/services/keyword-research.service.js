const fetch = require('node-fetch');

/**
 * Etsy Autocomplete'den gerçek arama önerileri çek
 */
async function getEtsyAutocomplete(keyword) {
    try {
        const encoded = encodeURIComponent(keyword);
        const url = `https://www.etsy.com/api/v3/ajax/suggest/search-suggestions?q=${encoded}&context=listing_search`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.etsy.com/',
                'x-detected-locale': 'USD|en-US|US'
            },
            timeout: 8000
        });

        if (!response.ok) return [];

        const data = await response.json();

        // Etsy response formatı: { results: [{ query: "..." }, ...] }
        const suggestions = data?.results?.map(r => r.query || r.search_query || r.term) || [];
        return suggestions.filter(Boolean).slice(0, 10);

    } catch (err) {
        console.warn('[Keyword] Etsy autocomplete failed:', err.message);
        return [];
    }
}

/**
 * Birden fazla seed keyword için Etsy önerileri topla
 */
async function expandKeywords(seedKeywords) {
    const allSuggestions = new Set(seedKeywords);

    const results = await Promise.allSettled(
        seedKeywords.slice(0, 5).map(kw => getEtsyAutocomplete(kw))
    );

    results.forEach(result => {
        if (result.status === 'fulfilled') {
            result.value.forEach(s => allSuggestions.add(s));
        }
    });

    return Array.from(allSuggestions).slice(0, 30);
}

/**
 * Google Trends'den keyword trend skoru çek
 */
async function getGoogleTrends(keywords) {
    try {
        const keyword = keywords.slice(0, 3).join(' ');
        const encoded = encodeURIComponent(keyword);
        const url = `https://trends.google.com/trends/api/autocomplete/${encoded}`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            },
            timeout: 8000
        });

        if (!response.ok) return { trending: [], seasonal: false };

        const text = await response.text();

        // Google, JSON hijacking koruması için yanıt başına çeşitli çöp önek ekler:
        //   )]}'\n   ,  ")]}'",  {\"default\"...  vb.
        // Strateji: İlk { veya [ karakterine kadar her şeyi sil.
        const cleanJson = text.replace(/^[^{[]*/, '').trim();

        if (!cleanJson) return { trending: [], seasonal: false };

        let data;
        try {
            data = JSON.parse(cleanJson);
        } catch (parseErr) {
            // Hata ayıklama için ilk 60 karakteri logla
            console.warn('[Trends] JSON parse hatası. Ham yanıt başı:', text.slice(0, 60));
            return { trending: [], seasonal: false };
        }

        const trending = data?.default?.topics?.map(t => t.mid || t.title?.query) || [];
        return { trending: trending.filter(Boolean).slice(0, 5), seasonal: false };

    } catch (err) {
        console.warn('[Keyword] Google Trends failed:', err.message);
        return { trending: [], seasonal: false };
    }
}

/**
 * Etsy'nin trend olan kategorilerini çek
 */
async function getEtsyTrending() {
    try {
        const url = 'https://www.etsy.com/api/v3/ajax/member/homepage/sections/trending-items';
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json',
                'Referer': 'https://www.etsy.com/'
            },
            timeout: 8000
        });

        if (!response.ok) return [];
        const data = await response.json();
        return data?.items?.map(i => i.title)?.slice(0, 10) || [];
    } catch {
        return [];
    }
}

module.exports = {
    getEtsyAutocomplete,
    expandKeywords,
    getGoogleTrends,
    getEtsyTrending
};
