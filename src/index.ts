import "@dotenvx/dotenvx/config";
import { extractGADMData } from "./lib/extract-gadm-data";
import { splitGridCell } from "./lib/hex-grid-generator";
import { getActiveSettings } from "./lib/settings";

const settings = await getActiveSettings();
await extractGADMData(settings);
const newCircleCount = await splitGridCell(settings, 1);
console.log("New grid cells created:", newCircleCount);
// await generateCountryGrid(settings);
