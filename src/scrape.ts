import { PuppeteerBlocker } from "@ghostery/adblocker-puppeteer";
import { Page } from "puppeteer";
import { connect, PageWithCursor } from "puppeteer-real-browser";
import { setupCleanup } from "./lib/scrape/cleanup";
import { startConsentHandler } from "./lib/scrape/consent";

interface BusinessDetails {
  id: string;
  name: string;
  businessType: string | null;
  reviewScore: number | null;
  reviewCount: number | null;
  address: string | null;
  phone: string | null;
  website: string | null;
}

const { page, browser } = await connect({
  headless: false,
  turnstile: true,
  disableXvfb: true,
});

await setupCleanup(browser, page);
startConsentHandler(page);
PuppeteerBlocker.fromPrebuiltAdsAndTracking(fetch).then((blocker) =>
  blocker.enableBlockingInPage(page as unknown as Page)
);

const url =
  "https://www.google.com/maps/search/steuerberater/@52.5200,13.4050,15z?hl=en";

while (true) {
  try {
    await page.goto(url, { timeout: 10000 });

    if (await scrollToLoadAll(page)) {
      console.log("Finished scrolling, extracting business details...");
      const businesses = await extractBusinessDetails(page);

      // Deduplicate by ID
      const uniqueBusinesses = businesses.filter(
        (business, index, self) =>
          index === self.findIndex((b) => b.id === business.id)
      );

      console.log(
        `Extracted ${uniqueBusinesses.length} unique businesses (${businesses.length - uniqueBusinesses.length} duplicates removed):`
      );
      console.log(JSON.stringify(uniqueBusinesses, null, 2));
      break;
    }

    console.log("Infinite loading detected, retrying...");
  } catch (error) {
    console.error("Attempt failed, retrying");
  }
}

async function scrollToLoadAll(page: PageWithCursor): Promise<boolean> {
  let loadingCount = 0;

  while (loadingCount < 10) {
    const hasEnded = await page.evaluate(
      () =>
        document.body.textContent?.includes(
          "You've reached the end of the list."
        ) ?? false
    );

    if (hasEnded) {
      console.log("Reached end of results");
      return true;
    }

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

    const currentCount = await page.$$eval(
      '[role="article"]',
      (articles) => articles.length
    );
    console.log(`Currently loaded: ${currentCount} businesses`);

    await page.evaluate(() => {
      document.querySelector('[role="feed"]')?.scrollTo(0, 999999);
    });

    await new Promise((resolve) => setTimeout(resolve, 3500));
  }

  return false;
}

async function extractBusinessDetails(
  page: PageWithCursor
): Promise<BusinessDetails[]> {
  return await page.evaluate(() => {
    const articles = document.querySelectorAll('[role="article"]');
    const businesses: BusinessDetails[] = [];

    articles.forEach((article) => {
      try {
        const name = article.getAttribute("aria-label")?.trim() || "";
        if (!name) return;

        // Create unique ID from Google Maps place ID
        let id = "";
        const linkElement = article.querySelector('a[href*="/maps/place/"]');
        if (linkElement) {
          const href = linkElement.getAttribute("href") || "";
          const cidMatch = href.match(/!1s0x[a-f0-9]+:0x[a-f0-9]+/);
          if (cidMatch) {
            id = cidMatch[0].substring(3);
          }
        }

        if (!id) {
          id = name
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "-")
            .substring(0, 50);
        }

        // Extract review data
        let reviewScore: number | null = null;
        let reviewCount: number | null = null;

        const starElement = article.querySelector(
          '[role="img"][aria-label*="stars"]'
        );
        if (starElement) {
          const ariaLabel = starElement.getAttribute("aria-label") || "";
          const scoreMatch = ariaLabel.match(/(\d+\.?\d*)\s+stars/);
          const countMatch = ariaLabel.match(/(\d+)\s+[Rr]eviews?/);

          if (scoreMatch) reviewScore = parseFloat(scoreMatch[1]!);
          if (countMatch) reviewCount = parseInt(countMatch[1]!);
        }

        // Extract business type and address using the · pattern
        let businessType: string | null = null;
        let address: string | null = null;
        let phone: string | null = null;

        // Find element containing ·
        const separatorElements = Array.from(
          article.querySelectorAll("*")
        ).filter(
          (el) =>
            el.textContent?.includes("·") && el.textContent.trim().length < 100
        );

        for (const sepElement of separatorElements) {
          // Go up to find the W4Efsd container or similar
          let container = sepElement.closest("div");
          if (container) {
            const spans = container.querySelectorAll("span");

            if (spans.length >= 2) {
              // First span is usually business type
              const firstSpanText = spans[0]?.textContent?.trim();
              if (
                firstSpanText &&
                !firstSpanText.includes("·") &&
                !businessType
              ) {
                businessType = firstSpanText;
              }

              // Last span is usually address
              const lastSpanText = spans[spans.length - 1]?.textContent?.trim();
              if (lastSpanText && !lastSpanText.includes("·") && !address) {
                // Make sure it looks like an address (contains letters and numbers)
                if (
                  /\d/.test(lastSpanText) &&
                  /[a-zA-Z]{2,}/.test(lastSpanText)
                ) {
                  address = lastSpanText;
                }
              }
            }
          }
        }

        // Extract phone number from all text
        const allText = article.textContent || "";
        const phonePatterns = [
          /(\+\d{1,3}[-.\s]?)?\(?\d{3,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,9}/,
          /\b0\d{2,3}[\s\-]?\d{4,8}\b/, // German format
        ];

        for (const pattern of phonePatterns) {
          const match = allText.match(pattern);
          if (match) {
            const phoneCandidate = match[0].trim();
            // Basic validation - should be reasonable length
            if (phoneCandidate.replace(/\D/g, "").length >= 7) {
              phone = phoneCandidate;
              break;
            }
          }
        }

        // Website extraction
        let website: string | null = null;

        const websiteButton = article.querySelector(
          '[aria-label*="website" i], [aria-label*="Visit" i]'
        );
        if (websiteButton) {
          const href = websiteButton.getAttribute("href");
          if (href) {
            try {
              const url = new URL(href, window.location.origin);

              const adurl = url.searchParams.get("adurl");
              if (adurl) {
                website = adurl;
              } else {
                const urlParam = url.searchParams.get("url");
                if (urlParam) {
                  website = decodeURIComponent(urlParam);
                } else if (
                  href.startsWith("http") &&
                  !href.includes("google.com/url")
                ) {
                  website = href;
                }
              }
            } catch (e) {
              const onclick = websiteButton.getAttribute("onclick") || "";
              const urlMatch = onclick.match(/https?:\/\/[^\s'"]+/);
              if (urlMatch) {
                website = urlMatch[0];
              }
            }
          }
        }

        if (!website) {
          const links = article.querySelectorAll('a[href*="http"]');
          for (const link of Array.from(links)) {
            const href = link.getAttribute("href") || "";
            if (
              href &&
              !href.includes("google.com/maps") &&
              !href.includes("google.com/search")
            ) {
              try {
                const url = new URL(href, window.location.origin);
                const adurl = url.searchParams.get("adurl");
                if (adurl) {
                  website = adurl;
                  break;
                }
              } catch (e) {
                continue;
              }
            }
          }
        }

        businesses.push({
          id,
          name,
          businessType,
          reviewScore,
          reviewCount,
          address,
          phone,
          website,
        });
      } catch (error) {
        console.error("Error processing business article:", error);
      }
    });

    return businesses;
  });
}
