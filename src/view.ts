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
  <title>Grid Viewer - Hybrid Theme</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    body { margin: 0; background: #1a1a1a; }
    #map { height: 100vh; }
    .legend {
       background: rgba(26, 26, 26, 0.9);
       color: #ffffff;
       padding: 12px;
       border-radius: 8px;
       box-shadow: 0 0 20px rgba(0,0,0,0.5);
       border: 1px solid #333;
    }
    .legend h4 {
       margin: 0 0 8px 0;
       color: #ffffff;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const map = L.map('map').setView([51.1657, 10.4515], 6);
    
    // Maptiler Hybrid (satellite + labels) theme
    L.tileLayer('https://api.maptiler.com/maps/hybrid/{z}/{x}/{y}.jpg?key=get_your_own_OpIi9ZULNHzrESv6T2vL', {
      attribution: '© MapTiler © OpenStreetMap contributors',
      maxZoom: 20
    }).addTo(map);

    // Add Germany borders with enhanced visibility for satellite theme
    fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson')
      .then(response => response.json())
      .then(data => {
        const germany = data.features.find(feature => {
          const name = feature.properties.ADMIN || feature.properties.NAME || feature.properties.name;
          return name === 'Germany' || name === 'Deutschland';
        });
        
        if (germany) {
          // Triple layer for maximum visibility on satellite imagery
          // Outer glow
          L.geoJSON(germany, {
            style: {
              color: '#00ffff',        // Cyan glow
              weight: 8,
              opacity: 0.4,
              fillColor: 'transparent',
              fillOpacity: 0
            }
          }).addTo(map);
          
          // Middle layer
          L.geoJSON(germany, {
            style: {
              color: '#ffffff',        // White
              weight: 5,
              opacity: 0.8,
              fillColor: 'transparent',
              fillOpacity: 0
            }
          }).addTo(map);
          
          // Main border
          L.geoJSON(germany, {
            style: {
              color: '#ffff00',        // Bright yellow - highly visible on satellite
              weight: 3,
              opacity: 1,
              fillColor: 'transparent',
              fillOpacity: 0
            }
          }).addTo(map);
        }
      })
      .catch(err => console.log('GeoJSON failed:', err));

    const gridData = {{GRID_DATA}};
    
    // Enhanced colors for better visibility on satellite imagery
    const colors = [
      '#ff0040', // Bright red
      '#ff4000', // Red-orange  
      '#ff8000', // Orange
      '#ffbf00', // Yellow-orange
      '#80ff00', // Bright green
      '#00ff80', // Green-cyan
      '#00bfff', // Sky blue
      '#4080ff', // Blue
      '#8040ff'  // Purple
    ];
    
    gridData.forEach(cell => {
      const color = colors[cell.level] || '#ffffff';
      const fillColor = cell.processed ? color : 'transparent';
      const opacity = cell.processed ? 0.7 : 0.4;
      const weight = 2;
      
      L.circle([cell.lat, cell.lng], {
        radius: cell.radius,
        color: color,
        fillColor: fillColor,
        fillOpacity: opacity,
        weight: weight
      }).bindPopup(\`
        <div style="background: #1a1a1a; color: #fff; padding: 8px; border-radius: 4px;">
          <b>Cell:</b> \${cell.id}<br>
          <b>Level:</b> \${cell.level}<br>
          <b>Radius:</b> \${cell.radius}m<br>
          <b>Status:</b> \${cell.processed ? '✅ Processed' : '⏳ Pending'}
        </div>
      \`, {
        className: 'custom-popup'
      }).addTo(map);
    });

    // Dark themed legend
    const legend = L.control({position: 'topright'});
    legend.onAdd = function(map) {
      const div = L.DomUtil.create('div', 'legend');
      div.innerHTML = \`
        <h4>Grid Levels</h4>
        \${colors.map((color, i) => 
          \`<div style="margin: 4px 0;">
            <span style="background:\${color}; width:16px; height:16px; display:inline-block; margin-right:8px; border-radius:2px; border:1px solid #555;"></span>
            Level \${i}
          </div>\`
        ).join('')}
        <hr style="border-color: #444; margin: 8px 0;">
        <div><span style="background:rgba(128,255,0,0.7); width:16px; height:16px; display:inline-block; margin-right:8px; border-radius:2px;"></span> Processed</div>
        <div><span style="border: 2px solid #80ff00; background:transparent; width:12px; height:12px; display:inline-block; margin-right:8px; border-radius:2px;"></span> Pending</div>
        <div style="margin-top: 8px;"><span style="border: 3px solid #ffff00; background:transparent; width:12px; height:12px; display:inline-block; margin-right:8px; box-shadow: 0 0 4px #00ffff;"></span> Germany Border</div>
      \`;
      return div;
    };
    legend.addTo(map);

    // Custom popup styling
    const style = document.createElement('style');
    style.innerHTML = \`
      .leaflet-popup-content-wrapper {
        background: rgba(26, 26, 26, 0.95) !important;
        border-radius: 8px !important;
      }
      .leaflet-popup-tip {
        background: rgba(26, 26, 26, 0.95) !important;
      }
    \`;
    document.head.appendChild(style);
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
