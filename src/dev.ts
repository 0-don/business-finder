import "@dotenvx/dotenvx/config";
import { extractGADMData } from "./lib/extract-gadm-data";
import { getActiveSettings } from "./lib/settings";
import { GridScraper } from "./service/grid-scraper";

const settings = await getActiveSettings();
await extractGADMData(settings);

const scraper = new GridScraper(settings);
await scraper.initialize();

console.log("Starting grid scraping...");

while (true) {
  const result = await scraper.processNextCell();
  if (!result) break;

  // Add delay between cells to avoid being blocked
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

await scraper.destroy();
console.log("Grid scraping complete!");
