import "@dotenvx/dotenvx/config";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { COUNTRY_CODE } from "./lib/constants";
import { generateCountryGrid } from "./lib/hex-grid-generator";

await db.execute(sql`DELETE FROM grid_cell`);
await generateCountryGrid(COUNTRY_CODE);
// await gridManager.clearGrid();
// await gridManager.initializeCountryGrid();
// await gridManager.showLevelStats();
