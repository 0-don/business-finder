import { PageWithCursor } from "puppeteer-real-browser";
import type { Browser } from "rebrowser-puppeteer-core";

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
