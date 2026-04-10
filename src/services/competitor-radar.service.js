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

      // Extract listing names and prices
      const designs = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.listing-link'));
        return items.map(item => ({
          title: item.querySelector('h3')?.textContent?.trim(),
          price: item.querySelector('.currency-value')?.textContent?.trim(),
          url: item.getAttribute('href')
        })).slice(0, 10); // Last 10 listings
      });

      return { success: true, designs };
    } catch (error) {
      console.error("[Radar] Scan failed:", error.message);
      return { success: false, error: error.message };
    } finally {
      await browser.close();
    }
  }
}

module.exports = new CompetitorRadarService();
