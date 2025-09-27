import "@dotenvx/dotenvx/config";

import { DEFAULT_COUNTRY_CODE } from "./lib/constants";
import { generateCountryGrid } from "./lib/hex-grid-generator";

await generateCountryGrid(DEFAULT_COUNTRY_CODE);
