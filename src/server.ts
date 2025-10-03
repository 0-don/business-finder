import "@dotenvx/dotenvx/config";
import { readFileSync } from "fs";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { GridRepository } from "./lib/grid-repositroy";
import { getActiveSettings } from "./lib/settings";

const PORT = process.env.PORT || 3000;
const HOST = process.env.DOCKER ? ("0.0.0.0" as const) : ("localhost" as const);

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url!, `http://${req.headers.host}`);

  if (url.pathname === "/api/grid-cells") {
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

    const settings = await getActiveSettings();
    try {
      const cells = await new GridRepository(settings).getCells(
        {
          north: bounds.north + buffer,
          south: bounds.south - buffer,
          east: bounds.east + buffer,
          west: bounds.west - buffer,
        },
        minRadius
      );

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(cells));
    } catch (error) {
      console.error("Error fetching grid cells:", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to fetch grid cells" }));
    }
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    try {
      const settings = await getActiveSettings();
      const geometry = await new GridRepository(settings).getCountryGeometry();

      let html = readFileSync("./index.html", "utf-8");
      html = html
        .replace("`{{GEOMETRY}}`", JSON.stringify(geometry))
        .replace(
          "{{GOOGLE_MAPS_JAVASCRIPT_API}}",
          process.env.GOOGLE_MAPS_JAVASCRIPT_API
        );

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    } catch (error) {
      console.error("Error serving HTML:", error);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
}

const server = createServer(handleRequest);

server.listen(Number(PORT), HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}/`);
});
