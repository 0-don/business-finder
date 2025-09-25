import "@dotenvx/dotenvx/config";
import { defineConfig } from "vite";

export function injectGridData() {
  return {
    name: "inject-grid-data",
    transformIndexHtml: async (html: string) => {
      const { db } = await import("./src/db/index.js");
      const { gridCellSchema } = await import("./src/db/schema.js");
      const { GridManager } = await import("./src/lib/grid-manager.js");

      const gridManager = new GridManager("DEU");

      // await gridManager.clearGrid();
      // await gridManager.initializeCountryGrid();

      const cells = await db.select().from(gridCellSchema);
      const gridData = cells.map((cell) => ({
        lat: parseFloat(cell.latitude),
        lng: parseFloat(cell.longitude),
        level: cell.level,
        radius: cell.radius,
      }));

      const geometry = await gridManager.getCountryGeometry();

      return html
        .replace("`{{GRID_DATA}}`", JSON.stringify(gridData))
        .replace("`{{GEOMETRY}}`", JSON.stringify(geometry))
        .replace(
          "{{GOOGLE_MAPS_JAVASCRIPT_API}}",
          process.env.GOOGLE_MAPS_JAVASCRIPT_API
        );
    },
  };
}
export default defineConfig({
  plugins: [injectGridData()],
  server: { port: 3000 },
});
