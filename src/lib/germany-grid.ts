// src/lib/germany-grid.ts - Fixed version
import {
  bbox,
  booleanPointInPolygon,
  centroid,
  distance,
  hexGrid,
  point,
} from "@turf/turf";
import cities from "all-the-cities";
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import worldData from "world-atlas/countries-50m.json" assert { type: "json" };

interface WorldAtlasTopology extends Topology {
  objects: {
    countries: GeometryCollection<{ name: string }>;
    land: GeometryCollection;
  };
}

// Fix the interface to match the actual all-the-cities structure
interface CityData {
  name: string;
  lat: number;
  lng: number;
  population: number;
  country: string;
}

export interface GridCell {
  lat: number;
  lng: number;
  cellSize: number;
  radius: number;
  populationDensity: "high" | "medium" | "low";
  nearestCity?: string;
}

const world = worldData as WorldAtlasTopology;

// Transform all-the-cities data to our expected format
const germanCities: CityData[] = cities
  .filter((city) => city.country === "DE" && city.population > 50000)
  .map((city) => ({
    name: city.name,
    lat: city.loc.coordinates[1], // Latitude is the second coordinate
    lng: city.loc.coordinates[0], // Longitude is the first coordinate
    population: city.population,
    country: city.country,
  }))
  .sort((a, b) => b.population - a.population);

console.log(`Found ${germanCities.length} German cities with 50k+ population`);

function getPopulationDensityCategory(
  population: number
): "high" | "medium" | "low" {
  if (population >= 500000) return "high"; // Major cities
  if (population >= 200000) return "medium"; // Medium cities
  return "low"; // Smaller cities
}

function getCellSizeForPopulation(population: number): number {
  if (population >= 1000000) return 15; // Very large cities (Berlin, Hamburg, Munich)
  if (population >= 500000) return 25; // Large cities
  if (population >= 200000) return 35; // Medium cities
  return 45; // Default for rural/small areas
}

function getSearchRadiusForCellSize(cellSize: number): number {
  // Search radius should be proportional to cell size
  return cellSize * 1000; // Convert km to meters
}

function isPointNearCity(
  lat: number,
  lng: number,
  cityData: CityData,
  cellSize: number
): boolean {
  const targetPoint = point([lng, lat]);
  const cityPoint = point([cityData.lng, cityData.lat]);
  const dist = distance(targetPoint, cityPoint, { units: "kilometers" });

  // Point is "near" if within 1.5x the cell size
  return dist <= cellSize * 1.5;
}

export function generatePopulationBasedGrid(): GridCell[] {
  // Extract Germany boundary
  const countries = feature(
    world,
    world.objects.countries
  ) as FeatureCollection<Polygon | MultiPolygon, { name: string }>;

  const germany = countries?.features?.find(
    (d): d is Feature<Polygon | MultiPolygon, { name: string }> =>
      d.properties?.name === "Germany"
  );

  if (!germany) throw new Error("Germany not found in world atlas");

  const germanyBbox = bbox(germany);
  const allGridCells: GridCell[] = [];

  // 1. Generate high-density grids for major cities
  console.log("Generating high-density grids for major cities...");
  for (const city of germanCities.filter((c) => c.population >= 500000)) {
    const cellSize = getCellSizeForPopulation(city.population);
    const radius = getSearchRadiusForCellSize(cellSize);

    // Create a bounding box around the city
    const cityRadius = cellSize * 2; // Coverage area around city
    const cityBbox: [number, number, number, number] = [
      city.lng - cityRadius / 111.32, // Now using the transformed data
      city.lat - cityRadius / 111.32,
      city.lng + cityRadius / 111.32,
      city.lat + cityRadius / 111.32,
    ];

    const cityGrid = hexGrid(cityBbox, cellSize, { units: "kilometers" });

    for (const hex of cityGrid.features) {
      const center = centroid(hex);
      const [lng, lat] = center.geometry.coordinates;

      if (booleanPointInPolygon(center, germany)) {
        allGridCells.push({
          lat: Math.round(lat! * 1000) / 1000,
          lng: Math.round(lng! * 1000) / 1000,
          cellSize,
          radius,
          populationDensity: getPopulationDensityCategory(city.population),
          nearestCity: city.name,
        });
      }
    }

    console.log(
      `  ${city.name}: ${cellSize}km cells, ${radius / 1000}km radius`
    );
  }

  // 2. Generate medium-density grids for medium cities
  console.log("Generating medium-density grids for medium cities...");
  for (const city of germanCities.filter(
    (c) => c.population >= 200000 && c.population < 500000
  )) {
    const cellSize = getCellSizeForPopulation(city.population);
    const radius = getSearchRadiusForCellSize(cellSize);

    const cityRadius = cellSize * 1.5;
    const cityBbox: [number, number, number, number] = [
      city.lng - cityRadius / 111.32,
      city.lat - cityRadius / 111.32,
      city.lng + cityRadius / 111.32,
      city.lat + cityRadius / 111.32,
    ];

    const cityGrid = hexGrid(cityBbox, cellSize, { units: "kilometers" });

    for (const hex of cityGrid.features) {
      const center = centroid(hex);
      const [lng, lat] = center.geometry.coordinates;

      if (booleanPointInPolygon(center, germany)) {
        // Check if this point is already covered by a high-density grid
        const alreadyCovered = allGridCells.some((cell) => {
          const dist = distance(
            point([lng!, lat!]),
            point([cell.lng, cell.lat]),
            { units: "kilometers" }
          );
          return dist < Math.min(cellSize, cell.cellSize);
        });

        if (!alreadyCovered) {
          allGridCells.push({
            lat: Math.round(lat! * 1000) / 1000,
            lng: Math.round(lng! * 1000) / 1000,
            cellSize,
            radius,
            populationDensity: getPopulationDensityCategory(city.population),
            nearestCity: city.name,
          });
        }
      }
    }

    console.log(
      `  ${city.name}: ${cellSize}km cells, ${radius / 1000}km radius`
    );
  }

  // 3. Fill remaining areas with standard 45km grid
  console.log("Filling remaining areas with standard grid...");
  const standardGrid = hexGrid(germanyBbox, 45, { units: "kilometers" });

  for (const hex of standardGrid.features) {
    const center = centroid(hex);
    const [lng, lat] = center.geometry.coordinates;

    if (booleanPointInPolygon(center, germany)) {
      // Check if this area is already covered
      const alreadyCovered = allGridCells.some((cell) => {
        const dist = distance(
          point([lng!, lat!]),
          point([cell.lng, cell.lat]),
          {
            units: "kilometers",
          }
        );
        return dist < 30; // 30km threshold for overlap
      });

      if (!alreadyCovered) {
        // Check if near any smaller city
        const nearbyCity = germanCities.find((city) =>
          isPointNearCity(lat!, lng!, city, 45)
        );

        allGridCells.push({
          lat: Math.round(lat! * 1000) / 1000,
          lng: Math.round(lng! * 1000) / 1000,
          cellSize: 45,
          radius: 45000,
          populationDensity: "low",
          nearestCity: nearbyCity?.name,
        });
      }
    }
  }

  console.log(`Generated ${allGridCells.length} total grid cells`);
  console.log(
    `  High density: ${allGridCells.filter((c) => c.populationDensity === "high").length}`
  );
  console.log(
    `  Medium density: ${allGridCells.filter((c) => c.populationDensity === "medium").length}`
  );
  console.log(
    `  Low density: ${allGridCells.filter((c) => c.populationDensity === "low").length}`
  );

  return allGridCells;
}

export const GERMANY_POPULATION_GRID = generatePopulationBasedGrid();
