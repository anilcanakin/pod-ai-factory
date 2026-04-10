const { launchBrowser } = require('./etsy-browser.service');

/**
 * CompetitorRadarService
 * Scrapes rival Etsy shops to identify trending designs and niches
 */
class CompetitorRadarService {
  /**
   * scanCompetitor
   * Scrapes the 'Sales' or 'Listings' of a rival shop
   */
  async scanCompetitor(shopUrl) {
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
