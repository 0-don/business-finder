// vite.config.ts (continued)
import "@dotenvx/dotenvx/config";
import { sql } from "drizzle-orm";
import { defineConfig, ViteDevServer } from "vite";
import { db } from "./src/db/index.js";
import { gridCellSchema } from "./src/db/schema.js";
import { getCountryGeometry } from "./src/lib/hex-grid-generator.js";
import { getActiveSettings } from "./src/lib/settings.js";

export function injectGridData() {
  return {
    name: "inject-grid-data",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/grid-cells", async (req, res) => {
        const url = new URL(req.url!, `http://${req.headers.host}`);
        const bounds = {
          north: parseFloat(url.searchParams.get("north") || "0"),
          south: parseFloat(url.searchParams.get("south") || "0"),
          east: parseFloat(url.searchParams.get("east") || "0"),
          west: parseFloat(url.searchParams.get("west") || "0"),
        };
        const zoom = parseInt(url.searchParams.get("zoom") || "6");

        const buffer = 0.45;
        const expandedBounds = {
          north: bounds.north + buffer,
          south: bounds.south - buffer,
          east: bounds.east + buffer,
          west: bounds.west - buffer,
        };

        let minRadius = 200;
        if (zoom <= 6) minRadius = 5000;
        else if (zoom <= 7) minRadius = 3000;
        else if (zoom <= 8) minRadius = 2000;
        else if (zoom <= 9) minRadius = 1000;
        else if (zoom <= 10) minRadius = 500;
        else if (zoom <= 11) minRadius = 300;

        const settings = await getActiveSettings();
        try {
          const cells = await db
            .select({
              id: gridCellSchema.id,
              lat: sql<number>`ST_Y(${gridCellSchema.center})`,
              lng: sql<number>`ST_X(${gridCellSchema.center})`,
              radius: gridCellSchema.radiusMeters,
              level: gridCellSchema.level,
            })
            .from(gridCellSchema)
            .where(
              sql`
                ST_Intersects(
                  ${gridCellSchema.center},
                  ST_MakeEnvelope(${expandedBounds.west}, ${expandedBounds.south}, 
                                ${expandedBounds.east}, ${expandedBounds.north}, 4326)
                )
                AND ${gridCellSchema.radiusMeters} >= ${minRadius}
                AND ${gridCellSchema.settingsId} = ${settings.id}
              `
            );

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(cells));
        } catch (error) {
          console.error("Error fetching grid cells:", error);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: "Failed to fetch grid cells" }));
        }
      });
    },
    transformIndexHtml: async (html: string) => {
      const settings = await getActiveSettings();
      const geometry = await getCountryGeometry(settings);

      return html
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
  server: {
    port: 3000,
    host: process.env.DOCKER ? "0.0.0.0" : undefined,
    allowedHosts: true,
  },
});
