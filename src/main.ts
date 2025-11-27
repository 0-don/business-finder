import "@dotenvx/dotenvx/config";
import { log } from "console";
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

const existingCellsCount = await REPO.getExistingCellsCount();

if (existingCellsCount === 0) {
  log("No existing grid cells found, generating new grid...");
  const bounds = await REPO.getBounds(SETTINGS.countryCode);
  const candidates = Geometry.generateHexGrid(bounds, RADIUS);

  const valid = await REPO.validatePoints(
    candidates,
    RADIUS,
    SETTINGS.countryCode
  );
  log(`Generated ${candidates.length} candidate grid cells.`);

  if (valid.length) {
    await REPO.insertCells(valid.map((center) => ({ center, radius: RADIUS })));
  }
  log(`Inserted ${valid.length} grid cells into the database.`);
} else {
  log(
    `Found ${existingCellsCount} existing grid cells, skipping grid generation.`
  );
}

await SCRAPER.initialize();

while (true) {
  const result = await SCRAPER.processNextCell();
  if (!result) break;
}

log("Grid scraping complete!");
