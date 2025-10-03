import "@dotenvx/dotenvx/config";
import { defineConfig, ViteDevServer } from "vite";

export function injectGridData() {
  let settingsCache: any = null;
  let geometryCache: any = null;

  async function ensureData() {
    if (!settingsCache) {
      const { getActiveSettings } = await import("./src/lib/settings.js");
      const { GridRepository } = await import("./src/lib/grid-repositroy.js");

      settingsCache = await getActiveSettings();
      geometryCache = await new GridRepository(
        settingsCache
      ).getCountryGeometry();
    }
    return { settings: settingsCache, geometry: geometryCache };
  }

  return {
    name: "inject-grid-data",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/grid-cells", async (req, res) => {
        try {
          const { GridRepository } = await import(
            "./src/lib/grid-repositroy.js"
          );
          const { settings } = await ensureData();

          const url = new URL(req.url!, `http://${req.headers.host}`);
          const bounds = {
            north: parseFloat(url.searchParams.get("north") || "0"),
            south: parseFloat(url.searchParams.get("south") || "0"),
            east: parseFloat(url.searchParams.get("east") || "0"),
            west: parseFloat(url.searchParams.get("west") || "0"),
          };
          const zoom = parseInt(url.searchParams.get("zoom") || "6");

          const buffer = 0.45;

          let minRadius = 200;
          if (zoom <= 6) minRadius = 5000;
          else if (zoom <= 7) minRadius = 3000;
          else if (zoom <= 8) minRadius = 2000;
          else if (zoom <= 9) minRadius = 1000;
          else if (zoom <= 10) minRadius = 500;
          else if (zoom <= 11) minRadius = 300;

          const cells = await new GridRepository(settings).getCells(
            {
              north: bounds.north + buffer,
              south: bounds.south - buffer,
              east: bounds.east + buffer,
              west: bounds.west - buffer,
            },
            minRadius
          );

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(cells));
        } catch (error) {
          console.error("Error in /api/grid-cells:", error);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(error) }));
        }
      });
    },
    transformIndexHtml: {
      order: "pre",
      async handler(html: string) {
        try {
          const { geometry } = await ensureData();

          return html
            .replace("`{{GEOMETRY}}`", JSON.stringify(geometry))
            .replace(
              "{{GOOGLE_MAPS_JAVASCRIPT_API}}",
              process.env.GOOGLE_MAPS_JAVASCRIPT_API
            );
        } catch (error) {
          console.error("Error transforming HTML:", error);
          return html
            .replace("`{{GEOMETRY}}`", "null")
            .replace(
              "{{GOOGLE_MAPS_JAVASCRIPT_API}}",
              process.env.GOOGLE_MAPS_JAVASCRIPT_API
            );
        }
      },
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
