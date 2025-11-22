import { PageWithCursor } from "puppeteer-real-browser";

export function startConsentHandler(page: PageWithCursor) {
  let isRunning = true;

  // Stop when page closes
  page.on("close", () => {
    isRunning = false;
  });

  async function checkConsent() {
    while (isRunning) {
      try {
        const acceptButton = await page.$('button[aria-label="Accept all"]');
        if (acceptButton) {
          const isVisible = await acceptButton.isIntersectingViewport();
          if (isVisible) {
            await acceptButton.click();
            console.log("Clicked Accept all button");
          }
        }
      } catch (err) {
        // Silently continue
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  checkConsent();
}
