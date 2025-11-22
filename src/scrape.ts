import { connect } from "puppeteer-real-browser";
import { startConsentHandler } from "./lib/scrape/consent";

const { page } = await connect({
  headless: false,
  turnstile: true,
  disableXvfb: true,
});

startConsentHandler(page);

await page.goto(
  "https://www.google.com/maps/search/steuerberater/@51.1657,10.4515,15z?hl=en"
);
