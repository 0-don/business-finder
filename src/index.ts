import "@dotenvx/dotenvx/config";
import { GridManager } from "./lib/grid-manager";

const gridManager = new GridManager("DEU");

await gridManager.clearGrid();
await gridManager.initializeCountryGrid();
