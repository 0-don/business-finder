import { defineConfig } from "vite";
import { db } from "./src/db/index.js";
import { gridCellSchema } from "./src/db/schema.js";
import { GRID_MANAGER } from "./src/lib/constants.js";

async function getGridData() {
  await GRID_MANAGER.clearGrid();
  await GRID_MANAGER.initializeGermanyGrid();

  const cells = await db.select().from(gridCellSchema);
  return cells.map((cell) => ({
    id: cell.cellId,
    lat: parseFloat(cell.latitude),
    lng: parseFloat(cell.longitude),
    radius: cell.radius,
    level: cell.level,
    processed: cell.isProcessed,
  }));
}

export function injectGridData() {
  return {
    name: "inject-grid-data",
    transformIndexHtml: async (html: string) => {
      try {
        const gridData = await getGridData();
        return html.replace("`{{GRID_DATA}}`", JSON.stringify(gridData));
      } catch (error) {
        console.error("Failed to load grid data:", error);
        return html.replace("{{GRID_DATA}}", "[]");
      }
    },
  };
}

export default defineConfig({
  plugins: [injectGridData()],
  server: {
    port: 3000,
  },
});
