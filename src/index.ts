import "@dotenvx/dotenvx/config";
import { extractGADMData } from "./lib/extract-gadm-data";
import { getActiveSettings } from "./lib/settings";
import { GridGenerator } from "./service/grid-generator";

const settings = await getActiveSettings();
await extractGADMData(settings);
await new GridGenerator(settings).generate();
