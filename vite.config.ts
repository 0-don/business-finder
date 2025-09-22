import { defineConfig } from "vite";

export function injectGridData() {
  return {
    name: "inject-grid-data",
    transformIndexHtml: async (html: string) => {
      const { db } = await import("./src/db/index.js");
      const { gridCellSchema } = await import("./src/db/schema.js");
      const { GRID_MANAGER } = await import("./src/lib/constants.js");

      await GRID_MANAGER.clearGrid();
      await GRID_MANAGER.initializeGermanyGrid();

      const cells = await db.select().from(gridCellSchema);
      const gridData = cells.map((cell) => ({
        id: cell.cellId,
        lat: parseFloat(cell.latitude),
        lng: parseFloat(cell.longitude),
        radius: cell.radius,
        level: cell.level,
        processed: cell.isProcessed,
      }));

      return html.replace("`{{GRID_DATA}}`", JSON.stringify(gridData));
    },
  };
}

export default defineConfig({
  plugins: [injectGridData()],
  server: {
    port: 3000,
  },
});
