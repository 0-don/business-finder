import "@dotenvx/dotenvx/config";
import { extractGADMData } from "./lib/extract-gadm-data";
import { getActiveSettings } from "./lib/settings";
import { CellProcessor } from "./service/cell-processor";
import { GridGenerator } from "./service/grid-generator";

const settings = await getActiveSettings();
await extractGADMData(settings);
console.log(settings);
const processor = new CellProcessor(settings);
const generator = new GridGenerator(settings);

// await generator.split(1);

while (true) {
  const result = await processor.processNext();
  console.log(result);
  if (!result) break;
  if (result.needsSplit) await generator.split(result.cellId);
}

console.log("Processing complete!");
