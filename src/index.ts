import "@dotenvx/dotenvx/config";
import { COUNTRY_CODE } from "./lib/constants";
import { generateCountryGrid } from "./lib/hex-grid-generator";

await generateCountryGrid(COUNTRY_CODE);
