import "@dotenvx/dotenvx/config";
import { extractGADMData } from "./lib/extract-gadm-data";
import { getActiveSettings } from "./lib/settings";
import { splitGridCell } from "./lib/circle-packing";

const settings = await getActiveSettings();
await extractGADMData(settings);
const newCircleCount = await splitGridCell(settings, 2);
console.log("New grid cells created:", newCircleCount);
// await generateCountryGrid(settings);
