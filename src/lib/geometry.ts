import { sql } from "drizzle-orm/sql";
import { Geometry } from "wkx";
import { GeoJSONGeometry } from "../types";

export function toPostGisGeometry(wkbData: Uint8Array | null) {
  if (!wkbData) return null;
  try {
    const buffer = Buffer.from(wkbData);
    const geometry = Geometry.parse(buffer);
    const geoJson = geometry.toGeoJSON() as GeoJSONGeometry;

    if (geoJson.type === "Polygon") {
      geoJson.type = "MultiPolygon";
      geoJson.coordinates = [geoJson.coordinates as number[][][]];
    }
    return sql`ST_GeomFromText(${geometry.toWkt()}, 4326)`;
  } catch {
    return null;
  }
}

export const latSpacing = (radius: number) => (radius * 2 * 360.0) / 40008000.0;
