import "@dotenvx/dotenvx/config";
import { extractGADMData } from "./lib/extract-gadm-data";
import { getActiveSettings } from "./lib/settings";
import { Geometry } from "./service/geometry";
import { GridRepository } from "./service/grid-repositroy";
import { GridScraper } from "./service/grid-scraper";

const RADIUS = 2500;

const SETTINGS = await getActiveSettings();
const REPO = new GridRepository(SETTINGS);
const SCRAPER = new GridScraper(SETTINGS);

await extractGADMData(SETTINGS);

const bounds = await REPO.getBounds(SETTINGS.countryCode);
const candidates = Geometry.generateHexGrid(bounds, RADIUS);
const valid = await REPO.validatePoints(
  candidates,
  RADIUS,
  SETTINGS.countryCode
);

if (valid.length) {
  await REPO.insertCells(valid.map((center) => ({ center, radius: RADIUS })));
}

await SCRAPER.initialize();

while (true) {
  const result = await SCRAPER.processNextCell();
  if (!result) break;

  // Add delay between cells to avoid being blocked
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

await SCRAPER.destroy();
console.log("Grid scraping complete!");
