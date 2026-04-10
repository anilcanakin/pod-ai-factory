const { chromium } = require('playwright');
const path = require('path');

const BROWSER_USER_DATA = process.env.BROWSER_USER_DATA ||
    path.join(process.env.USERPROFILE || process.env.HOME,
    'AppData/Local/Google/Chrome/User Data');

const BROWSER_EXE = process.env.BROWSER_EXE ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe';

/**
 * Launch browser with user's existing Chrome profile (already logged into Etsy)
 */
async function launchBrowser() {
    const browser = await chromium.launchPersistentContext(BROWSER_USER_DATA, {
        executablePath: BROWSER_EXE,
        headless: false,
        viewport: { width: 1280, height: 800 },
        args: ['--remote-debugging-port=9334']
    });
    return browser;
}

/**
 * Create a new Etsy draft listing
 */
async function createEtsyDraft(listing) {
    const browser = await launchBrowser();
    const page = browser.pages()[0] || await browser.newPage();
    try {
        await page.goto('https://www.etsy.com/sell/listings/new', { waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);
        const titleInput = await page.locator('input[name="title"], #title-input, [data-testid="title"]').first();
        await titleInput.click({ clickCount: 3 });
        await titleInput.fill(listing.title);
        const descInput = await page.locator('textarea[name="description"], #description-input').first();
        await descInput.click({ clickCount: 3 });
        await descInput.fill(listing.description);
        for (const tag of listing.tags.slice(0, 13)) {
            const tagInput = await page.locator('input[placeholder*="tag"], input[name*="tag"]').first();
            await tagInput.fill(tag);
            await tagInput.press('Enter');
            await page.waitForTimeout(300);
        }
        if (listing.price) {
            const priceInput = await page.locator('input[name="price"], #price-input').first();
            await priceInput.click({ clickCount: 3 });
            await priceInput.fill(String(listing.price));
        }
        if (listing.imageUrls && listing.imageUrls.length > 0) {
            const fs = require('fs');
            const os = require('os');
            const tmpDir = path.join(os.tmpdir(), 'etsy-upload');
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
            const imagePaths = [];
            for (let i = 0; i < listing.imageUrls.length; i++) {
                const url = listing.imageUrls[i];
                const tmpPath = path.join(tmpDir, `image-${Date.now()}-${i}.jpg`);
                const fetch = require('node-fetch');
                const response = await fetch(url);
                const buffer = await response.buffer();
                fs.writeFileSync(tmpPath, buffer);
                imagePaths.push(tmpPath);
            }
            const fileInput = await page.locator('input[type="file"]').first();
            await fileInput.setInputFiles(imagePaths);
            await page.waitForTimeout(3000);
        }
        const draftButton = await page.locator('button:has-text("Save as draft"), button:has-text("Save draft"), [data-testid="save-draft"]').first();
        await draftButton.click();
        await page.waitForTimeout(2000);
        return { success: true, message: 'Draft listing created successfully' };
    } catch (err) {
        console.error('[Etsy Browser] Error:', err.message);
        return { success: false, error: err.message };
    } finally {
        await browser.close();
    }
}

/**
 * Scrape all listings from Etsy seller dashboard
 */
async function scrapeListings() {
    const browser = await launchBrowser();
    const page = browser.pages()[0] || await browser.newPage();
    const listings = [];
    try {
        await page.goto('https://www.etsy.com/sell/listings', { waitUntil: 'networkidle' });
        let hasMore = true;
        while (hasMore) {
            const items = await page.locator('[data-listing-id]').all();
            for (const item of items) {
                const id = await item.getAttribute('data-listing-id');
                const title = await item.locator('h3, .listing-title').first().textContent().catch(() => '');
                const price = await item.locator('.price, [data-price]').first().textContent().catch(() => '');
                if (id && !listings.find(l => l.id === id)) {
                    listings.push({ id, title: title?.trim(), price: price?.trim() });
                }
            }
            const nextButton = await page.locator('a[rel="next"], button:has-text("Next")').first();
            if (await nextButton.isVisible()) {
                await nextButton.click();
                await page.waitForTimeout(2000);
            } else {
                hasMore = false;
            }
        }
        return { success: true, listings };
    } catch (err) {
        return { success: false, error: err.message, listings };
    } finally {
        await browser.close();
    }
}

/**
 * Scrape stats (Impressions, Visits, Orders) from Etsy Listings page (Stats view)
 */
async function getListingStats() {
    const browser = await launchBrowser();
    const page = browser.pages()[0] || await browser.newPage();
    const stats = [];
    try {
        await page.goto('https://www.etsy.com/sell/listings?view=stats', { waitUntil: 'networkidle' });
        await page.waitForTimeout(3000);
        const items = await page.locator('[data-listing-id]').all();
        for (const item of items) {
            const id = await item.getAttribute('data-listing-id');
            const visits = await item.locator('.visits-column, [data-visits]').first().textContent().catch(() => '0');
            const orders = await item.locator('.orders-column, [data-orders]').first().textContent().catch(() => '0');
            const revenue = await item.locator('.revenue-column, [data-revenue]').first().textContent().catch(() => '$0');
            if (id) {
                stats.push({
                    listingId: id,
                    visits: parseInt(visits.replace(/[^0-9]/g, '') || '0'),
                    orders: parseInt(orders.replace(/[^0-9]/g, '') || '0'),
                    revenue: revenue.trim()
                });
            }
        }
        return { success: true, stats };
    } catch (err) {
        return { success: false, error: err.message, stats };
    } finally {
        await browser.close();
    }
}

/**
 * Update an existing listing's price, title, or tags via browser
 */
async function updateListing(listingId, updates) {
    const browser = await launchBrowser();
    const page = browser.pages()[0] || await browser.newPage();
    try {
        console.log(`[Etsy Browser] Updating listing ${listingId}...`);
        await page.goto(`https://www.etsy.com/sell/listings/${listingId}/edit`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);
        if (updates.price) {
            const priceInput = await page.locator('input[name="price"], #price-input').first();
            await priceInput.click({ clickCount: 3 });
            await priceInput.fill(String(updates.price));
        }
        if (updates.title) {
            const titleInput = await page.locator('input[name="title"], #title-input').first();
            await titleInput.click({ clickCount: 3 });
            await titleInput.fill(updates.title);
        }
        if (updates.tags && updates.tags.length > 0) {
            const deleteButtons = await page.locator('button[data-testid="tag-delete-button"]').all();
            for (const btn of deleteButtons) await btn.click();
            for (const tag of updates.tags.slice(0, 13)) {
                const tagInput = await page.locator('input[placeholder*="tag"], input[name*="tag"]').first();
                await tagInput.fill(tag);
                await tagInput.press('Enter');
                await page.waitForTimeout(200);
            }
        }
        const publishButton = await page.locator('button:has-text("Publish Changes"), button:has-text("Publish"), button[data-testid="publish-button"]').first();
        await publishButton.click();
        await page.waitForTimeout(3000);
        return { success: true };
    } catch (err) {
        console.error(`[Etsy Browser] Update failed for ${listingId}:`, err.message);
        return { success: false, error: err.message };
    } finally {
        await browser.close();
    }
}

async function pinToPinterest(pin) {
    const browser = await launchBrowser();
    const page = browser.pages()[0] || await browser.newPage();
    try {
        await page.goto('https://www.pinterest.com/pin-builder/', { waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);
        const fetch = require('node-fetch');
        const fs = require('fs');
        const os = require('os');
        const tmpPath = path.join(os.tmpdir(), `pin-${Date.now()}.jpg`);
        const response = await fetch(pin.imageUrl);
        const buffer = await response.buffer();
        fs.writeFileSync(tmpPath, buffer);
        const fileInput = await page.locator('input[type="file"]').first();
        await fileInput.setInputFiles(tmpPath);
        await page.waitForTimeout(2000);
        const titleInput = await page.locator('input[placeholder*="title"], [data-test="pin-title-input"]').first();
        await titleInput.fill(pin.title.slice(0, 100));
        const descInput = await page.locator('textarea[placeholder*="description"], [data-test="pin-description-input"]').first();
        await descInput.fill(pin.description.slice(0, 500));
        if (pin.link) {
            const linkInput = await page.locator('input[placeholder*="link"], input[placeholder*="destination"]').first();
            await linkInput.fill(pin.link);
        }
        const publishBtn = await page.locator('button:has-text("Publish"), [data-test="publish-button"]').first();
        await publishBtn.click();
        await page.waitForTimeout(3000);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    } finally {
        await browser.close();
    }
}

module.exports = { launchBrowser, createEtsyDraft, scrapeListings, pinToPinterest, getListingStats, updateListing };
