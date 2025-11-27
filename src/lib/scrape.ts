import { mkdirSync } from "fs";
import { join, resolve } from "path";
import { PageWithCursor } from "puppeteer-real-browser";
import type { Browser } from "rebrowser-puppeteer-core";

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

export async function extractBusinessDetails(
  page: PageWithCursor
): Promise<BusinessDetails[]> {
  return await page.evaluate(() => {
    const articles = document.querySelectorAll('[role="article"]');
    const businesses: BusinessDetails[] = [];

    articles.forEach((article) => {
      try {
        const name = article.getAttribute("aria-label")?.trim();
        if (!name) return;

        // Extract ID from Google Maps URL
        let id = "";
        const linkElement = article.querySelector('a[href*="/maps/place/"]');
        if (linkElement) {
          const cidMatch = linkElement
            .getAttribute("href")
            ?.match(/!1s0x[a-f0-9]+:0x[a-f0-9]+/);
          if (cidMatch) id = cidMatch[0].substring(3);
        }
        if (!id)
          id = name
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "-")
            .substring(0, 50);

        // Extract reviews
        let reviewScore: number | null = null;
        let reviewCount: number | null = null;
        const starElement = article.querySelector(
          '[role="img"][aria-label*="stars"]'
        );
        console.log("Star element HTML:", starElement?.outerHTML);
        console.log(
          "Star element aria-label:",
          starElement?.getAttribute("aria-label")
        );
        if (starElement) {
          const ariaLabel = starElement.getAttribute("aria-label") || "";
          const scoreMatch = ariaLabel.match(/(\d+\.?\d*)\s+stars/);
          const countMatch = ariaLabel.match(/(\d+)\s+[Rr]eviews?/);
          if (scoreMatch) reviewScore = parseFloat(scoreMatch[1]!);
          if (countMatch) reviewCount = parseInt(countMatch[1]!);
        }

        // Extract business type and address using · separator pattern
        let businessType: string | null = null;
        let address: string | null = null;

        const separatorElements = Array.from(
          article.querySelectorAll("*")
        ).filter(
          (el) =>
            el.textContent?.includes("·") && el.textContent.trim().length < 100
        );

        for (const sepElement of separatorElements) {
          const container = sepElement.closest("div");
          const spans = container?.querySelectorAll("span");
          if (spans && spans.length >= 2) {
            const firstSpanText = spans[0]?.textContent?.trim();
            if (
              firstSpanText &&
              !firstSpanText.includes("·") &&
              !businessType
            ) {
              businessType = firstSpanText;
            }

            const lastSpanText = spans[spans.length - 1]?.textContent?.trim();
            if (
              lastSpanText &&
              !lastSpanText.includes("·") &&
              !address &&
              /\d/.test(lastSpanText) &&
              /[a-zA-Z]{2,}/.test(lastSpanText)
            ) {
              address = lastSpanText;
            }
          }
        }

        // Extract phone
        const phoneMatch = article.textContent?.match(
          /\b0\d{2,3}[\s\-]?\d{4,8}\b/
        );
        const phone =
          phoneMatch && phoneMatch[0].replace(/\D/g, "").length >= 7
            ? phoneMatch[0].trim()
            : null;

        // Extract website
        let website: string | null = null;
        const websiteButton = article.querySelector(
          '[aria-label*="website" i], [aria-label*="Visit" i]'
        );
        if (websiteButton) {
          const href = websiteButton.getAttribute("href");
          if (href) {
            try {
              const url = new URL(href, window.location.origin);
              website =
                url.searchParams.get("adurl") ||
                (url.searchParams.get("url")
                  ? decodeURIComponent(url.searchParams.get("url")!)
                  : null) ||
                (href.startsWith("http") && !href.includes("google.com/url")
                  ? href
                  : null);
            } catch (e) {
              const urlMatch = websiteButton
                .getAttribute("onclick")
                ?.match(/https?:\/\/[^\s'"]+/);
              if (urlMatch) website = urlMatch[0];
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

export async function scrollToLoadAll(page: PageWithCursor): Promise<boolean> {
  let loadingCount = 0;

  while (loadingCount < 10) {
    if (
      await page.evaluate(
        () =>
          document.body.textContent?.includes(
            "You've reached the end of the list."
          ) ?? false
      )
    ) {
      return true;
    }

    const isLoading = await page.evaluate(() =>
      Array.from(document.querySelectorAll("*")).some((el) => {
        const styles = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          styles.animationName?.includes("container-rotate") &&
          styles.animationPlayState === "running" &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.top < window.innerHeight &&
          rect.bottom > 0
        );
      })
    );

    if (isLoading) loadingCount++;

    await page.evaluate(() =>
      document.querySelector('[role="feed"]')?.scrollTo(0, 999999)
    );
    await new Promise((resolve) => setTimeout(resolve, 3500));
  }

  return false;
}

export async function setupCleanup(browser: Browser, page: PageWithCursor) {
  await browser.setCookie(
    {
      name: "CONSENT",
      value: "YES+cb.20210630-14-p0.en+FX+700",
      domain: ".google.com",
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // 1 year from now
      size: 0,
      httpOnly: false,
      secure: true,
      session: false,
    },
    {
      name: "SOCS",
      value: "CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg",
      domain: ".google.com",
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // 1 year from now
      size: 0,
      httpOnly: false,
      secure: true,
      session: false,
    }
  );

  const cleanup = async () => {
    console.log("Cleaning up browser...");
    try {
      if (page) await page.close();
      if (browser) await browser.close();
    } catch (error) {
      console.error("Error during cleanup:", error);
    }
    process.exit(0);
  };

  // Set up signal handlers
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("SIGUSR2", cleanup); // tsx watch restart signal

  return cleanup;
}

export const startStream = async (page: PageWithCursor): Promise<void> => {
  if (process.platform === "win32") return;

  const streamDir = join(resolve(), "stream");
  mkdirSync(streamDir, { recursive: true });

  const captureScreenshot = async () => {
    try {
      await page.screenshot({
        path: "./stream/page.jpg",
        optimizeForSpeed: true,
        type: "jpeg",
        quality: 80,
      });
    } catch (error) {
      // Silently handle errors during screenshot capture
    }
  };

  // Take screenshot every 2 seconds
  setInterval(captureScreenshot, 2000);
};
