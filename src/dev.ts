import "@dotenvx/dotenvx/config";
import { extractGADMData } from "./lib/extract-gadm-data";
import { getActiveSettings } from "./lib/settings";
import { GridScraper } from "./service/grid-scraper";

const settings = await getActiveSettings();
await extractGADMData(settings);

