import "@dotenvx/dotenvx/config";
import { log } from "console";
import { extractGADMData } from "./lib/extract-gadm-data";
import { getActiveSettings } from "./lib/settings";
import { Geometry } from "./service/geometry";
import { GridRepository } from "./service/grid-repositroy";

const settings = await getActiveSettings();
await extractGADMData(settings);

const repo = new GridRepository(settings);

log(`Starting full Germany hex grid generation with 500m circles`);

// Get Germany bounds
const bounds = await repo.getBounds(settings.countryCode);
log(`Country bounds:`, bounds);

// Generate hex grid with 500m radius
const radius = 2500;
const level = 0;

log(`Generating hex grid with ${radius}m radius circles...`);
const candidates = Geometry.generateHexGrid(bounds, radius);
log(`Generated ${candidates.length} candidate positions`);

// Validate points are within Germany and don't overlap existing circles
log(`Validating points within Germany boundaries...`);
const valid = await repo.validatePoints(
  candidates,
  radius,
  settings.countryCode
);
log(`${valid.length} valid positions found`);

// Insert all circles at once
if (valid.length > 0) {
  log(`Inserting ${valid.length} grid cells...`);
  await repo.insertCells(
    valid.map((center) => ({ center, radius })),
    level
  );
  log(`Successfully inserted ${valid.length} grid cells`);
} else {
  log(`No valid positions to insert`);
}

const totalCount = await repo.getTotalCount();
log(`Total grid cells in database: ${totalCount}`);
log(`Grid generation complete!`);
