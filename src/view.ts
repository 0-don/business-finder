import "@dotenvx/dotenvx/config";
import { createServer } from "http";
import { db } from "./db";
import { gridCellSchema } from "./db/schema";
import { GRID_MANAGER } from "./lib/constants";

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

const HTML_TEMPLATE = `
<!DOCTYPE html>
<html>
<head>
  <title>Grid Viewer</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    body { margin: 0; background: #1a1a1a; }
    #map { height: 100vh; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const map = L.map('map').setView([51.1657, 10.4515], 6);
    
    L.tileLayer('https://api.maptiler.com/maps/hybrid/{z}/{x}/{y}.jpg?key=get_your_own_OpIi9ZULNHzrESv6T2vL', {
      attribution: '© MapTiler © OpenStreetMap contributors',
      maxZoom: 20
    }).addTo(map);

    // Germany border
    fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson')
      .then(response => response.json())
      .then(data => {
        const germany = data.features.find(feature => {
          const name = feature.properties.ADMIN || feature.properties.NAME || feature.properties.name;
          return name === 'Germany' || name === 'Deutschland';
        });
        
        if (germany) {
          L.geoJSON(germany, {
            style: {
              color: '#ffff00',
              weight: 3,
              opacity: 1,
              fillColor: 'transparent',
              fillOpacity: 0
            }
          }).addTo(map);
        }
      });

    const gridData = {{GRID_DATA}};
    
    const colors = [
      '#ff0040', '#ff4000', '#ff8000', '#ffbf00', '#80ff00',
      '#00ff80', '#00bfff', '#4080ff', '#8040ff'
    ];
    
    gridData.forEach(cell => {
      const color = colors[cell.level] || '#ffffff';
      const fillColor = cell.processed ? color : 'transparent';
      const opacity = cell.processed ? 0.7 : 0.4;
      
      L.circle([cell.lat, cell.lng], {
        radius: cell.radius,
        color: color,
        fillColor: fillColor,
        fillOpacity: opacity,
        weight: 2
      }).addTo(map);
    });
  </script>
</body>
</html>`;

const server = createServer(async (req, res) => {
  try {
    const gridData = await getGridData();
    const html = HTML_TEMPLATE.replace(
      "{{GRID_DATA}}",
      JSON.stringify(gridData)
    );

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  } catch (error) {
    console.error("Error serving request:", error);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Server Error");
  }
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Grid viewer running at http://localhost:${PORT}`);
});
