const { launchBrowser } = require('./etsy-browser.service');
const brainService = require('./multimodal-brain.service');

/**
 * CompetitorRadarService
 * Scrapes rival Etsy shops to identify trending designs and niches
 */
class CompetitorRadarService {
  /**
   * Builds a human-readable text summary from scraped designs
   * so the Brain / RAG system can index and retrieve it later.
   */
  _buildMemoryText(shopUrl, designs) {
    const shopName = shopUrl.split('/shop/')[1]?.split('?')[0] || shopUrl;

    const listingLines = designs
      .filter(d => d.title)
      .map((d, i) => `${i + 1}. "${d.title}"${d.price ? ` — ${d.price}` : ''}`)
      .join('\n');

    // Extract recurring words from titles as rough keyword signals
    const wordFreq = {};
    designs.forEach(d => {
      d.title.toLowerCase().split(/\W+/).filter(w => w.length > 3).forEach(w => {
        wordFreq[w] = (wordFreq[w] || 0) + 1;
      });
    });
    const topKeywords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([w]) => w)
      .join(', ');

    return `Competitor Shop: ${shopName}
Shop URL: ${shopUrl}
Scan Date: ${new Date().toISOString().split('T')[0]}
Total Listings Scanned: ${designs.length}

TOP LISTINGS:
${listingLines}

RECURRING KEYWORDS / NICHE SIGNALS:
${topKeywords || '(none detected)'}

STRATEGIC NOTES:
- These are the most visible products from ${shopName}'s storefront.
- Use recurring keywords for tag/title optimization.
- Identify price anchors and niche opportunities from the listing data above.`;
  }

  /**
   * scanCompetitor
   * Scrapes the listings of a rival shop and saves findings to Corporate Memory (fire-and-forget).
   */
  async scanCompetitor(shopUrl, workspaceId = 'default-workspace') {
    console.log(`[Radar] Scanning competitor: ${shopUrl}`);
    const browser = await launchBrowser();
    const page = browser.pages()[0] || await browser.newPage();

    try {
      await page.goto(shopUrl, { waitUntil: 'networkidle' });
      await page.waitForTimeout(3000);

      // Extract listing names and prices using Etsy's data attributes
      const designs = await page.evaluate(() => {
        const items = document.querySelectorAll('[data-listing-id]');
        return Array.from(items).slice(0, 20).map(item => ({
          id: item.getAttribute('data-listing-id'),
          title: item.querySelector('h3')?.textContent?.trim() || '',
          price: item.querySelector('[data-currency-value]')?.textContent?.trim() || '',
          url: item.querySelector('a')?.href || ''
        }));
      });

      // Fire-and-forget: save scan results to Corporate Memory / Brain
      if (designs.length > 0) {
        const shopName = shopUrl.split('/shop/')[1]?.split('?')[0] || 'Unknown Shop';
        const memoryText = this._buildMemoryText(shopUrl, designs);

        brainService.addTextKnowledge(
          workspaceId,
          `Competitor Scan: ${shopName} (${new Date().toLocaleDateString()})`,
          memoryText,
          shopUrl,
          'niche_research'
        ).then(() => {
          console.log(`[Radar] Intelligence from "${shopName}" saved to Corporate Memory`);
        }).catch(err => {
          console.warn('[Radar] Failed to save intelligence to brain:', err.message);
        });
      }

      return { success: true, designs };
    } catch (error) {
      console.error("[Radar] Scan failed:", error.message);
      return { success: false, error: error.message };
    } finally {
      await page.close(); // Close only the page, keep persistent browser session alive
    }
  }
}

module.exports = new CompetitorRadarService();
