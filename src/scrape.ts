import { PuppeteerBlocker } from "@ghostery/adblocker-puppeteer";
import { Page } from "puppeteer";
import { connect } from "puppeteer-real-browser";
import { setupCleanup } from "./lib/scrape/cleanup";
import { extractBusinessDetails } from "./lib/scrape/extract";
import { scrollToLoadAll } from "./lib/scrape/scroll";

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
  "https://www.google.com/maps/search/steuerberater/@52.5200,13.4050,15z?hl=en";

while (true) {
  try {
    await page.goto(url, { timeout: 10000 });

    if (await scrollToLoadAll(page)) {
      const businesses = await extractBusinessDetails(page);
      const uniqueBusinesses = businesses.filter(
        (business, index, self) =>
          index === self.findIndex((b) => b.id === business.id)
      );

      console.log(
        `Extracted ${uniqueBusinesses.length} unique businesses (${businesses.length - uniqueBusinesses.length} duplicates removed)`
      );
      console.log(JSON.stringify(uniqueBusinesses, null, 2));
      break;
    }

    console.log("Infinite loading detected, retrying...");
  } catch (error) {
    console.error("Attempt failed, retrying");
  }
}
