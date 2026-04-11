const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');

// ─── Stealth plugin: hides automation fingerprints from Etsy ──────────────────
chromium.use(StealthPlugin());

const BROWSER_USER_DATA = process.env.BROWSER_USER_DATA ||
    path.join(process.env.USERPROFILE || process.env.HOME,
    'AppData/Local/Google/Chrome/User Data');

const BROWSER_EXE = process.env.BROWSER_EXE ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe';

const SCREENSHOT_DIR = path.join(process.cwd(), 'assets', 'logs');

// ─── Shared Utilities ─────────────────────────────────────────────────────────

/**
 * Launch browser with user's existing Chrome profile (already logged into Etsy).
 * Uses stealth flags to suppress webdriver detection signals.
 */
async function launchBrowser() {
    if (!fs.existsSync(SCREENSHOT_DIR)) {
        fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    const browser = await chromium.launchPersistentContext(BROWSER_USER_DATA, {
        executablePath: BROWSER_EXE,
        headless: false,
        viewport: { width: 1280, height: 800 },
        args: [
            '--remote-debugging-port=9334',
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-infobars',
            '--disable-dev-shm-usage',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
    });
    return browser;
}

/**
 * Retry wrapper for browser operations.
 * On final failure, captures a full-page screenshot as evidence before re-throwing.
 *
 * @param {string}   operationName  - Label for logs
 * @param {Page}     page           - Playwright page object
 * @param {Function} fn             - Async operation to retry
 * @param {number}   maxAttempts    - Max retry count (default 3)
 */
async function withRetry(operationName, page, fn, maxAttempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            console.warn(`[Etsy Browser] ${operationName} — attempt ${attempt}/${maxAttempts} failed: ${err.message}`);

            if (attempt === maxAttempts) {
                // Final attempt failed — capture screenshot as forensic evidence
                const screenshotPath = path.join(SCREENSHOT_DIR, `etsy-error-${Date.now()}.png`);
                try {
                    await page.screenshot({ path: screenshotPath, fullPage: true });
                    console.error(`[Etsy Browser] Error screenshot saved → ${screenshotPath}`);
                } catch (ssErr) {
                    console.error('[Etsy Browser] Screenshot capture also failed:', ssErr.message);
                }
                throw lastError;
            }

            // Exponential back-off between retries (2s, 4s)
            await page.waitForTimeout(2000 * attempt);
        }
    }
}

// ─── Create Draft Listing ─────────────────────────────────────────────────────

/**
 * Create a new Etsy draft listing using resilient, role-based selectors.
 * Retries up to 3 times; screenshots on terminal failure.
 */
async function createEtsyDraft(listing) {
    const browser = await launchBrowser();
    const page = browser.pages()[0] || await browser.newPage();

    try {
        await page.goto('https://www.etsy.com/sell/listings/new', { waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);

        await withRetry('createEtsyDraft', page, async () => {
            // ── Title ────────────────────────────────────────────────────────
            const titleField = page.getByRole('textbox', { name: /title/i });
            await titleField.click({ clickCount: 3 });
            await titleField.fill(listing.title);

            // ── Description ──────────────────────────────────────────────────
            const descField = page.getByRole('textbox', { name: /description/i });
            await descField.click({ clickCount: 3 });
            await descField.fill(listing.description);

            // ── Tags ─────────────────────────────────────────────────────────
            for (const tag of listing.tags.slice(0, 13)) {
                const tagField = page.getByRole('textbox', { name: /tag/i });
                await tagField.fill(tag);
                await tagField.press('Enter');
                await page.waitForTimeout(300);
            }

            // ── Price ─────────────────────────────────────────────────────────
            if (listing.price) {
                const priceField = page.getByRole('spinbutton', { name: /price/i });
                await priceField.click({ clickCount: 3 });
                await priceField.fill(String(listing.price));
            }

            // ── Images ────────────────────────────────────────────────────────
            if (listing.imageUrls && listing.imageUrls.length > 0) {
                const nodeFetch = require('node-fetch');
                const os = require('os');
                const tmpDir = path.join(os.tmpdir(), 'etsy-upload');
                if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

                const imagePaths = [];
                for (let i = 0; i < listing.imageUrls.length; i++) {
                    const tmpPath = path.join(tmpDir, `image-${Date.now()}-${i}.jpg`);
                    const resp = await nodeFetch(listing.imageUrls[i]);
                    fs.writeFileSync(tmpPath, await resp.buffer());
                    imagePaths.push(tmpPath);
                }

                const fileInput = page.locator('input[type="file"]').first();
                await fileInput.setInputFiles(imagePaths);
                await page.waitForTimeout(3000);
            }

            // ── Save as Draft ─────────────────────────────────────────────────
            const draftButton = page.getByRole('button', { name: /save.*draft|save draft/i });
            await draftButton.click();
            await page.waitForTimeout(2000);
        });

        return { success: true, message: 'Draft listing created successfully' };
    } catch (err) {
        console.error('[Etsy Browser] createEtsyDraft permanently failed:', err.message);
        return { success: false, error: err.message };
    } finally {
        await browser.close();
    }
}

// ─── Scrape All Listings ──────────────────────────────────────────────────────

/**
 * Scrape all listings from the Etsy seller dashboard (paginated).
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
                const title = await item.locator('h3').first().textContent().catch(() => '');
                const price = await item.locator('[data-currency-value]').first().textContent().catch(() => '');
                if (id && !listings.find(l => l.id === id)) {
                    listings.push({ id, title: title?.trim(), price: price?.trim() });
                }
            }

            const nextButton = page.getByRole('link', { name: /next/i });
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

// ─── Listing Stats ────────────────────────────────────────────────────────────

/**
 * Scrape stats (Impressions, Visits, Orders) from Etsy Listings stats view.
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
            const visits  = await item.locator('[data-visits]').first().textContent().catch(() => '0');
            const orders  = await item.locator('[data-orders]').first().textContent().catch(() => '0');
            const revenue = await item.locator('[data-revenue]').first().textContent().catch(() => '$0');
            if (id) {
                stats.push({
                    listingId: id,
                    visits:  parseInt(visits.replace(/[^0-9]/g, '')  || '0'),
                    orders:  parseInt(orders.replace(/[^0-9]/g, '')  || '0'),
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

// ─── Update Listing ───────────────────────────────────────────────────────────

/**
 * Update an existing listing's price, title, or tags.
 * Retries up to 3 times; screenshots on terminal failure.
 */
async function updateListing(listingId, updates) {
    const browser = await launchBrowser();
    const page = browser.pages()[0] || await browser.newPage();

    try {
        console.log(`[Etsy Browser] Updating listing ${listingId}...`);
        await page.goto(`https://www.etsy.com/sell/listings/${listingId}/edit`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);

        await withRetry('updateListing', page, async () => {
            // ── Price ─────────────────────────────────────────────────────────
            if (updates.price) {
                const priceField = page.getByRole('spinbutton', { name: /price/i });
                await priceField.click({ clickCount: 3 });
                await priceField.fill(String(updates.price));
            }

            // ── Title ─────────────────────────────────────────────────────────
            if (updates.title) {
                const titleField = page.getByRole('textbox', { name: /title/i });
                await titleField.click({ clickCount: 3 });
                await titleField.fill(updates.title);
            }

            // ── Tags ──────────────────────────────────────────────────────────
            if (updates.tags && updates.tags.length > 0) {
                // Clear existing tags first
                const deleteButtons = await page.getByRole('button', { name: /remove tag|delete tag/i }).all();
                for (const btn of deleteButtons) await btn.click();

                for (const tag of updates.tags.slice(0, 13)) {
                    const tagField = page.getByRole('textbox', { name: /tag/i });
                    await tagField.fill(tag);
                    await tagField.press('Enter');
                    await page.waitForTimeout(200);
                }
            }

            // ── Publish ───────────────────────────────────────────────────────
            const publishButton = page.getByRole('button', { name: /publish/i });
            await publishButton.click();
            await page.waitForTimeout(3000);
        });

        return { success: true };
    } catch (err) {
        console.error(`[Etsy Browser] updateListing permanently failed for ${listingId}:`, err.message);
        return { success: false, error: err.message };
    } finally {
        await browser.close();
    }
}

// ─── Pinterest Pin ────────────────────────────────────────────────────────────

async function pinToPinterest(pin) {
    const browser = await launchBrowser();
    const page = browser.pages()[0] || await browser.newPage();

    try {
        const nodeFetch = require('node-fetch');
        const os = require('os');

        await page.goto('https://www.pinterest.com/pin-builder/', { waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);

        const tmpPath = path.join(os.tmpdir(), `pin-${Date.now()}.jpg`);
        const resp = await nodeFetch(pin.imageUrl);
        fs.writeFileSync(tmpPath, await resp.buffer());

        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.setInputFiles(tmpPath);
        await page.waitForTimeout(2000);

        await page.getByRole('textbox', { name: /title/i }).fill(pin.title.slice(0, 100));
        await page.getByRole('textbox', { name: /description/i }).fill(pin.description.slice(0, 500));

        if (pin.link) {
            await page.getByRole('textbox', { name: /link|destination/i }).fill(pin.link);
        }

        await page.getByRole('button', { name: /publish/i }).click();
        await page.waitForTimeout(3000);

        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    } finally {
        await browser.close();
    }
}

module.exports = { launchBrowser, createEtsyDraft, scrapeListings, pinToPinterest, getListingStats, updateListing };
