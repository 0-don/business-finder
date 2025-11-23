import { PuppeteerBlocker } from "@ghostery/adblocker-puppeteer";
import { Page } from "puppeteer";
import { connect, PageWithCursor } from "puppeteer-real-browser";
import { setupCleanup } from "./lib/scrape/cleanup";
import { startConsentHandler } from "./lib/scrape/consent";

const { page, browser } = await connect({
  headless: false,
  turnstile: true,
  disableXvfb: true,
});

setupCleanup(browser, page);
startConsentHandler(page);
PuppeteerBlocker.fromPrebuiltAdsAndTracking(fetch).then((blocker) =>
  blocker.enableBlockingInPage(page as unknown as Page)
);

const url =
  "https://www.google.com/maps/search/steuerberater/@52.5200,13.4050,15z?hl=en";

while (true) {
  try {
    await page.goto(url);

    if (await scrollToLoadAll(page)) {
      const count = await page.$$eval(
        '[role="article"]',
        (articles) => articles.length
      );
      console.log(`Final result count: ${count}`);
      break;
    }

    console.log("Infinite loading detected, retrying...");
  } catch (error) {
    console.error("Attempt failed, retrying:", error);
  }
}

async function scrollToLoadAll(page: PageWithCursor): Promise<boolean> {
  let loadingCount = 0;

  while (loadingCount < 10) {
    // Check if we've reached the end
    const hasEnded = await page.evaluate(
      () =>
        document.body.textContent?.includes(
          "You've reached the end of the list."
        ) ?? false
    );

    if (hasEnded) return true;

    // Check for loading animation visible on screen
    const isLoading = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll("*")).filter((el) => {
          const styles = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();

          return (
            styles.animationName &&
            styles.animationName.includes("container-rotate") &&
            styles.animationPlayState === "running" &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.top < window.innerHeight &&
            rect.bottom > 0
          );
        }).length > 0
    );

    if (isLoading) loadingCount++;

    // Scroll down
    await page.evaluate(() => {
      document.querySelector('[role="feed"]')?.scrollTo(0, 999999);
    });

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  return false; // Infinite loading suspected
}
