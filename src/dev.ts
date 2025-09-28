import "@dotenvx/dotenvx/config";
import { splitGridCell } from "./lib/circle-packing";
import { extractGADMData } from "./lib/extract-gadm-data";
import { getActiveSettings } from "./lib/settings";

const settings = await getActiveSettings();
await extractGADMData(settings);

await splitGridCell(settings, 1);

// await generateCountryGrid(settings);
