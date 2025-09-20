import { bbox, booleanPointInPolygon, centroid, hexGrid } from "@turf/turf";
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
    countries: GeometryCollection<{
      name: string;
    }>;
    land: GeometryCollection;
  };
}

const world = worldData as WorldAtlasTopology;

export function generateGermanyGrid(cellSizeKm = 45) {
  // Extract Germany from world atlas
  const countries = feature(
    world,
    world.objects.countries
  ) as FeatureCollection<Polygon | MultiPolygon, { name: string }>;

  console.log(countries);

  const germany = countries?.features?.find(
    (d): d is Feature<Polygon | MultiPolygon, { name: string }> =>
      d.properties?.name === "Germany"
  );

  if (!germany) throw new Error("Germany not found in world atlas");

  // Generate precise hex grid
  const germanyBbox = bbox(germany);
  const grid = hexGrid(germanyBbox, cellSizeKm, { units: "kilometers" });

  // Filter to only include points actually within Germany's borders
  return grid.features
    .map((hex) => centroid(hex))
    .filter((point) => booleanPointInPolygon(point, germany))
    .map((point) => ({
      lat: Math.round(point.geometry.coordinates[1]! * 1000) / 1000,
      lng: Math.round(point.geometry.coordinates[0]! * 1000) / 1000,
    }));
}

export const GERMANY_GRID = generateGermanyGrid(45);
