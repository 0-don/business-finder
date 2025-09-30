import "@dotenvx/dotenvx/config";
import { extractGADMData } from "./lib/extract-gadm-data";
import { getActiveSettings } from "./lib/settings";
import { CellProcessor } from "./service/cell-processor";
import { GridGenerator } from "./service/grid-generator";

const settings = await getActiveSettings();
await extractGADMData(settings);

const processor = new CellProcessor(settings);
const generator = new GridGenerator(settings);

await generator.split(1);
await generator.split(2);
await generator.split(3);
await generator.split(4);
await generator.split(5);

// while (true) {
//   const result = await processor.processNext();
//   console.log(result);
//   if (!result) break;
//   if (result.needsSplit) await generator.split(result.cellId);
// }

console.log("Processing complete!");
