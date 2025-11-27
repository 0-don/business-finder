import { PuppeteerBlocker } from "@ghostery/adblocker-puppeteer";
import { error, log } from "console";
import { Page } from "puppeteer";
import { connect } from "puppeteer-real-browser";
import {
  extractBusinessDetails,
  scrollToLoadAll,
  setupCleanup,
} from "./lib/scrape";

const { page, browser } = await connect({
  headless: false,
  turnstile: true,
  disableXvfb: true,
});

await setupCleanup(browser, page);
PuppeteerBlocker.fromPrebuiltAdsAndTracking(fetch).then((b) =>
  b.enableBlockingInPage(page as unknown as Page)
);

const url =
  "https://www.google.com/maps/search/steuerberater/@50.5234,10.9876,14z?hl=en";

while (true) {
  try {
    await page.goto(url, { timeout: 10000 });

    if (await scrollToLoadAll(page)) {
      const businesses = await extractBusinessDetails(page);
      const uniqueBusinesses = businesses.filter(
        (business, index, self) =>
          index === self.findIndex((b) => b.id === business.id)
      );

      log(JSON.stringify(uniqueBusinesses, null, 2));
      log(
        `Extracted ${uniqueBusinesses.length} unique businesses (${businesses.length - uniqueBusinesses.length} duplicates removed)`
      );
      break;
    }

    log("Infinite loading detected, retrying...");
  } catch {
    error("Attempt failed, retrying");
  }
}
