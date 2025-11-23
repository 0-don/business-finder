import { PageWithCursor } from "puppeteer-real-browser";

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
