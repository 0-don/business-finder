import "@dotenvx/dotenvx/config";
import { extractGADMData } from "./lib/extract-gadm-data";
import { GridRepository } from "./lib/grid-repositroy";
import { getActiveSettings } from "./lib/settings";
import { Geometry } from "./service/geometry";

// const settings = await getActiveSettings();
// await extractGADMData(settings);
// await new GridGenerator(settings).generate();

const settings = await getActiveSettings();
await extractGADMData(settings);

const repo = new GridRepository(settings);

console.log(`Starting full Germany hex grid generation with 500m circles`);

// Get Germany bounds
const bounds = await repo.getBounds(settings.countryCode);
console.log(`Country bounds:`, bounds);

// Generate hex grid with 500m radius
const radius = 2500;
const level = 0;

console.log(`Generating hex grid with ${radius}m radius circles...`);
const candidates = Geometry.generateHexGrid(bounds, radius);
console.log(`Generated ${candidates.length} candidate positions`);

// Validate points are within Germany and don't overlap existing circles
console.log(`Validating points within Germany boundaries...`);
const valid = await repo.validatePoints(
  candidates,
  radius,
  settings.countryCode
);
console.log(`${valid.length} valid positions found`);

// Insert all circles at once
if (valid.length > 0) {
  console.log(`Inserting ${valid.length} grid cells...`);
  await repo.insertCells(
    valid.map((center) => ({ center, radius })),
    level
  );
  console.log(`Successfully inserted ${valid.length} grid cells`);
} else {
  console.log(`No valid positions to insert`);
}

const totalCount = await repo.getTotalCount();
console.log(`Total grid cells in database: ${totalCount}`);
console.log(`Grid generation complete!`);
