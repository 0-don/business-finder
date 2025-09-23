import { defineConfig } from "vite";

export function injectGridData() {
  return {
    name: "inject-grid-data",
    transformIndexHtml: async (html: string) => {
      const { db } = await import("./src/db/index.js");
      const { gridCellSchema } = await import("./src/db/schema.js");
      const { GridManager } = await import("./src/lib/grid-manager.js");

      const gridManager = new GridManager("DEU");

      await gridManager.clearGrid();
      await gridManager.initializeCountryGrid();

      const cells = await db.select().from(gridCellSchema);
      const gridData = cells.map((cell) => ({
        id: cell.cellId,
        lat: parseFloat(cell.latitude),
        lng: parseFloat(cell.longitude),
        radius: cell.radius,
        level: cell.level,
        processed: cell.isProcessed,
      }));

      const germanyGeometry = await gridManager.getCountryGeometry();

      return html
        .replace("`{{GRID_DATA}}`", JSON.stringify(gridData))
        .replace("`{{GERMANY_GEOMETRY}}`", JSON.stringify(germanyGeometry))
        .replace(
          "{{GOOGLE_MAPS_JAVASRIPT_API}}",
          process.env.GOOGLE_MAPS_JAVASRIPT_API
        );
    },
  };
}
export default defineConfig({
  plugins: [injectGridData()],
  server: {
    port: 3000,
  },
});
