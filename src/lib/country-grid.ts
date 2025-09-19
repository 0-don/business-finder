export const isInGermany = (lat: number, lng: number) =>
  lat >= 47.27 && lat <= 55.05 && lng >= 5.87 && lng <= 15.04;

// Precise Germany coverage grid based on exact coordinates
export const GERMANY_GRID = [
  // Row 1 (Northernmost - includes Sylt island)
  { lat: 55.0, lng: 8.0 }, // Sylt/North Frisia
  { lat: 55.0, lng: 10.5 }, // Schleswig-Holstein center
  { lat: 55.0, lng: 13.0 }, // Mecklenburg coast
  { lat: 55.0, lng: 15.0 }, // Eastern border

  // Row 2 (Northern Germany ~53.5°N)
  { lat: 53.5, lng: 6.5 }, // East Frisia/Netherlands border
  { lat: 53.5, lng: 9.0 }, // Hamburg region
  { lat: 53.5, lng: 11.5 }, // Mecklenburg-Vorpommern
  { lat: 53.5, lng: 14.0 }, // Polish border region

  // Row 3 (North-Central ~52°N)
  { lat: 52.0, lng: 6.5 }, // Dutch border/Münster
  { lat: 52.0, lng: 9.0 }, // Hannover region
  { lat: 52.0, lng: 11.5 }, // Magdeburg/Brandenburg
  { lat: 52.0, lng: 13.5 }, // Berlin region
  { lat: 52.0, lng: 15.0 }, // Eastern Saxony

  // Row 4 (Central ~50.5°N)
  { lat: 50.5, lng: 6.0 }, // Belgian border/Aachen
  { lat: 50.5, lng: 8.5 }, // Frankfurt/Hesse
  { lat: 50.5, lng: 11.0 }, // Thuringia/Erfurt
  { lat: 50.5, lng: 13.5 }, // Dresden/Saxony
  { lat: 50.5, lng: 15.0 }, // Czech border

  // Row 5 (South-Central ~49°N)
  { lat: 49.0, lng: 6.5 }, // Saarland/French border
  { lat: 49.0, lng: 8.5 }, // Baden-Württemberg north
  { lat: 49.0, lng: 11.0 }, // Bavaria north/Nuremberg
  { lat: 49.0, lng: 13.5 }, // Bavaria east/Regensburg

  // Row 6 (Southern ~47.5°N)
  { lat: 47.5, lng: 7.5 }, // Swiss border/Black Forest
  { lat: 47.5, lng: 9.5 }, // Lake Constance/Stuttgart south
  { lat: 47.5, lng: 11.5 }, // Munich region
  { lat: 47.5, lng: 13.5 }, // Austrian border/Berchtesgaden
];
