import { connect } from "puppeteer-real-browser";

const { page } = await connect({
  headless: false,
  turnstile: true,
  disableXvfb: true,
});

await page.goto("https://disboard.org/");
