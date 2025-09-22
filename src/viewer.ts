import { serve } from "bun";
import { db } from "./db";
import { gridCellSchema } from "./db/schema";

async function getGridData() {
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
    #map { height: 100vh; }
    .legend { 
      background: white; 
      padding: 10px; 
      border-radius: 5px; 
      box-shadow: 0 0 15px rgba(0,0,0,0.2);
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const map = L.map('map').setView([51.1657, 10.4515], 6); // Germany center
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    const gridData = {{GRID_DATA}};
    
    const colors = ['#ff0000', '#ff7f00', '#ffff00', '#7fff00', '#00ff00', '#00ff7f', '#00ffff', '#007fff', '#0000ff'];
    
    gridData.forEach(cell => {
      const color = colors[cell.level] || '#000000';
      const fillColor = cell.processed ? color : 'transparent';
      const opacity = cell.processed ? 0.6 : 0.3;
      
      L.circle([cell.lat, cell.lng], {
        radius: cell.radius,
        color: color,
        fillColor: fillColor,
        fillOpacity: opacity,
        weight: 1
      }).bindPopup(\`
        <b>Cell:</b> \${cell.id}<br>
        <b>Level:</b> \${cell.level}<br>
        <b>Radius:</b> \${cell.radius}m<br>
        <b>Status:</b> \${cell.processed ? 'Processed' : 'Pending'}
      \`).addTo(map);
    });

    // Add legend
    const legend = L.control({position: 'topright'});
    legend.onAdd = function(map) {
      const div = L.DomUtil.create('div', 'legend');
      div.innerHTML = \`
        <h4>Grid Levels</h4>
        \${colors.map((color, i) => \`<i style="background:\${color};width:18px;height:18px;display:inline-block;margin-right:8px;"></i> Level \${i}\`).join('<br>')}
        <br><br>
        <b>Filled:</b> Processed<br>
        <b>Empty:</b> Pending
      \`;
      return div;
    };
    legend.addTo(map);
  </script>
</body>
</html>`;

serve({
  port: 3000,
  async fetch(req) {
    const gridData = await getGridData();
    const html = HTML_TEMPLATE.replace(
      "{{GRID_DATA}}",
      JSON.stringify(gridData)
    );
    return new Response(html, {
      headers: { "Content-Type": "text/html" },
    });
  },
});

console.log("Grid viewer running at http://localhost:3000");
