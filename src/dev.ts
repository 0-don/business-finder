import "@dotenvx/dotenvx/config";
import { generateCountryGrid } from "./lib/hex-grid-generator";
import { getActiveSettings } from "./lib/settings";
import { extractGADMData } from "./lib/extract-gadm-data";

const settings = await getActiveSettings();
await extractGADMData(settings);
await generateCountryGrid(settings);
