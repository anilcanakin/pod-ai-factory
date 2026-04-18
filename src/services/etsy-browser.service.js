const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');

// ─── Stealth plugin: hides automation fingerprints from Etsy ──────────────────
chromium.use(StealthPlugin());

// Isolated profile inside the project — never touches your personal Chrome session.
// Override via BROWSER_USER_DATA env var if you want a custom path.
const BROWSER_USER_DATA = process.env.BROWSER_USER_DATA ||
    path.join(process.cwd(), 'browser-data-etsy');

const BROWSER_EXE = process.env.BROWSER_EXE ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe';

// headless: true  → no visible window (default, bot runs silently in background)
// headless: false → visible browser (set BROWSER_HEADLESS=false for debugging)
const HEADLESS = process.env.BROWSER_HEADLESS !== 'false';

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

    if (!fs.existsSync(BROWSER_USER_DATA)) {
        fs.mkdirSync(BROWSER_USER_DATA, { recursive: true });
    }

    const browser = await chromium.launchPersistentContext(BROWSER_USER_DATA, {
        executablePath: BROWSER_EXE,
        headless: HEADLESS,
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
 * Fallback mock data — lets the AI audit run even when Etsy is unreachable.
 * isMock:true signals to the caller that real data wasn't available.
 */
function _mockStats() {
    return [
        { listingId: 'MOCK-001', title: 'Mock Listing (Etsy not connected)', visits: 120, orders: 2, revenue: '$38.00', isMock: true },
        { listingId: 'MOCK-002', title: 'Mock Listing 2',                    visits: 45,  orders: 0, revenue: '$0.00',  isMock: true },
    ];
}

/**
 * Scrape listing stats from Etsy Shop Manager.
 * Tries three selector strategies in order; falls back to mock data so the
 * AI audit can still run even when the browser session is not logged in.
 *
 * Returns: { success, stats, scraped, isMock?, error? }
 *
 * Browser lifecycle rules (NO try/finally — each exit point decides explicitly):
 *   - HEADLESS=true  → always close browser before returning
 *   - HEADLESS=false → NEVER close browser on error/login paths; user closes manually.
 *                      Browser is only closed after a successful scrape.
 */
async function getListingStats() {
    // ── Launch ────────────────────────────────────────────────────────────────
    let browser;
    try {
        browser = await launchBrowser();
    } catch (err) {
        console.error('[Etsy Stats] Browser launch failed:', err.message);
        return { success: false, error: 'Browser launch failed', stats: _mockStats(), isMock: true };
    }

    const page = browser.pages()[0] || await browser.newPage();
    const stats = [];

    // Helper: close browser only in headless mode.
    // In visible mode the user closes it themselves — closing here would make
    // the window disappear before they can see what went wrong.
    const closeIfHeadless = async () => {
        if (HEADLESS) await browser.close().catch(() => {});
        else console.log('[Etsy Stats] 🪟 Browser left open — close it manually when done.');
    };

    // ── Step 1: Open sign-in page ─────────────────────────────────────────────
    console.log('[Etsy Stats] → Navigating to https://www.etsy.com/signin');
    await page.goto('https://www.etsy.com/signin', { waitUntil: 'commit', timeout: 30000 }).catch(e => {
        console.warn('[Etsy Stats] goto /signin soft error (ignored):', e.message);
    });

    // Give Etsy's JS redirect from /signin → /sign-in time to settle
    await page.waitForTimeout(5000);

    const landedUrl = page.url();
    console.log(`[Etsy Stats] Landed on: ${landedUrl}`);

    // ── Step 2: Detect whether we're on the sign-in page ─────────────────────
    const urlIndicatesLogin = /sign-?in|login|auth/i.test(landedUrl);
    const formVisible = await page.locator('input[type="password"]').isVisible().catch(() => false);
    const onSignIn = urlIndicatesLogin || formVisible;

    console.log(`[Etsy Stats] onSignIn=${onSignIn} (urlMatch=${urlIndicatesLogin}, formVisible=${formVisible})`);

    if (onSignIn) {
        if (!HEADLESS) {
            // Visible mode: keep browser open, wait for the user to log in
            console.log('[Etsy Stats] 🕐 Sign-in page detected. Please log in in the browser window. Waiting 180 s...');
            try {
                await page.waitForURL(
                    u => u.includes('shop-manager') || u.includes('/sell/listings') ||
                         u.includes('/your/account') || u.includes('/your/shops'),
                    { timeout: 180000 }
                );
                console.log(`[Etsy Stats] ✓ Login confirmed! Now on: ${page.url()}`);
            } catch {
                // Timeout — browser STAYS OPEN so the user can inspect or retry
                console.warn('[Etsy Stats] ⚠ Login wait timed out (180 s). Browser left open — close it manually.');
                return { success: false, error: 'Login timeout', stats: _mockStats(), isMock: true };
                // NOTE: no browser.close() here intentionally
            }
        } else {
            // Headless mode: can't show a login window, give up and close cleanly
            console.warn('[Etsy Stats] HEADLESS=true and not logged in. Set BROWSER_HEADLESS=false and log in once.');
            await browser.close().catch(() => {});
            return { success: false, error: 'Not logged in', stats: _mockStats(), isMock: true };
        }
    }

    // ── Step 3: Navigate to the Etsy Seller Hub listings page ──────────────────
    // Primary URL — new seller hub (confirmed working):
    const LISTINGS_URLS = [
        'https://www.etsy.com/your/shops/me/tools/listings?ref=seller-platform-mcnav',
        'https://www.etsy.com/your/shops/me/listings',
        'https://www.etsy.com/shop-manager/listings',
    ];

    for (const url of LISTINGS_URLS) {
        console.log(`[Etsy Stats] → Trying listings URL: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
            .catch(e => { console.warn(`[Etsy Stats] goto soft error (ignored): ${e.message}`); });
        await page.waitForTimeout(3000);

        const landed = page.url();
        console.log(`[Etsy Stats] Landed on: ${landed}`);

        if (!/uh.?oh|404|signin|login/i.test(landed)) {
            console.log('[Etsy Stats] ✓ Listings page reached.');
            break;
        }
        console.warn(`[Etsy Stats] ⚠ Blocked at ${landed} — trying next URL...`);
    }

    const listingsUrl = page.url();
    console.log(`[Etsy Stats] Final listings page: ${listingsUrl}`);

    if (/signin|login|uh.?oh/i.test(listingsUrl)) {
        const shot = path.join(SCREENSHOT_DIR, `etsy-blocked-${Date.now()}.png`);
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        console.warn(`[Etsy Stats] ⚠ Could not reach Listings page. Screenshot: ${shot}`);
        await closeIfHeadless();
        return { success: false, error: 'Could not reach Listings page', stats: _mockStats(), isMock: true };
    }

    // ── Debug screenshot ──────────────────────────────────────────────────────
    const debugShot = path.join(SCREENSHOT_DIR, `etsy-stats-${Date.now()}.png`);
    await page.screenshot({ path: debugShot, fullPage: false }).catch(() => {});
    console.log(`[Etsy Stats] Screenshot saved → ${debugShot}`);

    // ── Scraping — wrapped in try/catch; browser lifecycle handled below ──────
    try {
        // Strategy 1: data-listing-id attributes (older Etsy layout)
        const dataItems = await page.locator('[data-listing-id]').all();
        if (dataItems.length > 0) {
            console.log(`[Etsy Stats] Strategy 1 — found ${dataItems.length} [data-listing-id] nodes`);
            for (const item of dataItems) {
                const id      = await item.getAttribute('data-listing-id');
                const title   = await item.locator('h3, [class*="title"]').first().textContent().catch(() => '');
                const visits  = await item.locator('[data-visits],  [class*="visit"]').first().textContent().catch(() => '0');
                const orders  = await item.locator('[data-orders],  [class*="order"]').first().textContent().catch(() => '0');
                const revenue = await item.locator('[data-revenue], [class*="revenue"]').first().textContent().catch(() => '$0');
                if (id) {
                    stats.push({
                        listingId: id,
                        title:   title.trim(),
                        visits:  parseInt(visits.replace(/[^0-9]/g, '')  || '0'),
                        orders:  parseInt(orders.replace(/[^0-9]/g, '')  || '0'),
                        revenue: revenue.trim(),
                    });
                }
            }
        }

        // Strategy 2: listing hrefs (/listing/NNNN)
        if (stats.length === 0) {
            console.log('[Etsy Stats] Strategy 2 — scraping /listing/ links');
            const links = await page.locator('a[href*="/listing/"]').all();
            const seen  = new Set();
            for (const link of links.slice(0, 100)) {
                const href  = await link.getAttribute('href').catch(() => '');
                const match = href?.match(/\/listing\/(\d+)/);
                if (match && !seen.has(match[1])) {
                    seen.add(match[1]);
                    const text = (await link.textContent().catch(() => '')).trim();
                    stats.push({ listingId: match[1], title: text, visits: 0, orders: 0, revenue: '$0' });
                }
            }
            console.log(`[Etsy Stats] Strategy 2 — found ${stats.length} listings`);
        }

        // Strategy 3: page text extraction (last resort)
        if (stats.length === 0) {
            console.warn('[Etsy Stats] Strategy 3 — no structured data found, extracting raw page text');
            const bodyText = await page.locator('body').textContent().catch(() => '');
            const ids = [...bodyText.matchAll(/listing[_\-/ ](\d{9,12})/gi)].map(m => m[1]);
            const unique = [...new Set(ids)];
            for (const id of unique.slice(0, 50)) {
                stats.push({ listingId: id, title: `Listing ${id}`, visits: 0, orders: 0, revenue: '$0' });
            }
            console.log(`[Etsy Stats] Strategy 3 — extracted ${stats.length} IDs from page text`);
        }
    } catch (scrapeErr) {
        // Scraping error — visible mode: keep browser open for inspection
        console.error('[Etsy Stats] Scrape error:', scrapeErr.message);
        await closeIfHeadless();
        return { success: false, error: scrapeErr.message, stats: _mockStats(), isMock: true };
    }

    if (stats.length === 0) {
        console.warn('[Etsy Stats] ⚠ All strategies exhausted — returning mock data for AI audit');
        await closeIfHeadless();
        return { success: false, error: 'No listings found on page', stats: _mockStats(), isMock: true };
    }

    // ── Success — always close browser (data is captured, no need to keep open) ──
    console.log(`[Etsy Stats] ✓ Scraped ${stats.length} listings successfully`);
    await browser.close().catch(() => {});
    return { success: true, stats, scraped: stats.length };
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
