import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { gridCellSchema } from "../db/schema";
import { Point, SettingsConfig } from "../types";

interface Circle {
  center: Point;
  radius: number;
}

/**
 * Converts a distance in meters to an approximate distance in degrees latitude.
 * @param meters - The distance in meters.
 * @returns The approximate distance in degrees.
 */
function metersToLatDegrees(meters: number): number {
  return meters / 111320;
}

/**
 * Converts a distance in meters to an approximate distance in degrees longitude.
 * @param meters - The distance in meters.
 * @param lat - The latitude at which the conversion is done.
 * @returns The approximate distance in degrees.
 */
function metersToLngDegrees(meters: number, lat: number): number {
  return meters / (111320 * Math.cos((lat * Math.PI) / 180));
}

/**
 * Generates candidate points in a hexagonal grid within the bounding box of a larger circle.
 * @param center - The center of the original circle.
 * @param radius - The radius of the original circle in meters.
 * @param candidateRadius - The radius of the candidate circles in meters.
 * @returns An array of candidate center points.
 */
function generateHexCandidates(
  center: Point,
  radius: number,
  candidateRadius: number
): Point[] {
  const candidates: Point[] = [];
  const searchBounds = {
    minLat: center.lat - metersToLatDegrees(radius),
    maxLat: center.lat + metersToLatDegrees(radius),
    minLng: center.lng - metersToLngDegrees(radius, center.lat),
    maxLng: center.lng + metersToLngDegrees(radius, center.lat),
  };

  const dy = metersToLatDegrees(candidateRadius * 1.5);
  let row = 0;

  for (let lat = searchBounds.minLat; lat <= searchBounds.maxLat; lat += dy) {
    const dx = metersToLngDegrees(candidateRadius * 1.732, lat);
    const xOffset = metersToLngDegrees(candidateRadius * 0.866, lat);
    const startLng = searchBounds.minLng + (row % 2 === 1 ? xOffset : 0);

    for (let lng = startLng; lng <= searchBounds.maxLng; lng += dx) {
      candidates.push({ lng, lat });
    }
    row++;
  }
  return candidates;
}

/**
 * Uses a PostGIS query to filter a list of candidate circles, returning only those
 * that are valid (within the parent boundary and not overlapping existing circles).
 * @param parentCenter - The center of the parent circle.
 * @param parentRadius - The radius of the parent circle.
 * @param candidates - An array of candidate circles to validate.
 * @param countryCode - The country code for scoping the overlap check.
 * @returns A promise that resolves to an array of valid center points.
 */
async function getValidPlacements(
  parentCenter: Point,
  parentRadius: number,
  candidates: Circle[],
  countryCode: string
): Promise<Point[]> {
  if (candidates.length === 0) return [];

  const valuesSql = candidates
    .map((c) => `(${c.center.lng}, ${c.center.lat}, ${c.radius})`)
    .join(", ");

  const parentCircleWKT = `ST_Buffer(ST_SetSRID(ST_Point(${parentCenter.lng}, ${parentCenter.lat}), 4326)::geography, ${parentRadius})::geometry`;

  const result = (await db.execute(sql`
    WITH candidates (lng, lat, radius) AS (VALUES ${sql.raw(valuesSql)})
    SELECT c.lng, c.lat FROM candidates c
    WHERE
      -- Filter 1: Ensure the candidate circle is fully within the parent circle.
      ST_Within(
        ST_Buffer(ST_SetSRID(ST_Point(c.lng, c.lat), 4326)::geography, c.radius)::geometry,
        ${sql.raw(parentCircleWKT)}
      )
      -- Filter 2: Ensure it does not overlap with any *already existing* circles.
      AND NOT EXISTS (
        SELECT 1 FROM grid_cell gc
        WHERE gc.country_code = ${countryCode}
        AND ST_DWithin(
          ST_SetSRID(ST_Point(c.lng, c.lat), 4326)::geography,
          gc.center::geography,
          c.radius + gc.radius_meters
        )
      )
  `)) as unknown as Point[];

  return result;
}

/**
 * Generates and inserts new circles by iteratively filling the parent circle's area.
 * It starts with larger circles and progressively uses smaller ones to fill the gaps.
 * @param settings - The active application settings.
 * @param parentCell - The properties of the cell being split.
 * @returns The total number of new circles inserted.
 */
async function generateAndInsertPackedCircles(
  settings: SettingsConfig,
  parentCell: { center: Point; radius: number; level: number }
): Promise<number> {
  let totalInserted = 0;
  // Start with a radius that is a fraction of the parent, allowing for multiple circles.
  let currentRadius = parentCell.radius / 2.5;

  while (currentRadius >= settings.minRadius) {
    const candidateCenters = generateHexCandidates(
      parentCell.center,
      parentCell.radius,
      currentRadius
    );
    const candidates = candidateCenters.map((center) => ({
      center,
      radius: currentRadius,
    }));

    // Use the database to efficiently find valid, non-overlapping placements
    const validPlacements = await getValidPlacements(
      parentCell.center,
      parentCell.radius,
      candidates,
      settings.countryCode
    );

    // Insert the valid circles for this radius level
    if (validPlacements.length > 0) {
      const values = validPlacements.map((p) => ({
        center: sql`ST_SetSRID(ST_Point(${p.lng}, ${p.lat}), 4326)`,
        radiusMeters: currentRadius,
        circle: sql`ST_Buffer(ST_SetSRID(ST_Point(${p.lng}, ${p.lat}), 4326)::geography, ${currentRadius})::geometry`,
        level: parentCell.level + 1,
        countryCode: settings.countryCode,
      }));

      await db.insert(gridCellSchema).values(values);
      totalInserted += validPlacements.length;
    }

    // Reduce the radius to fill in the remaining gaps in the next iteration.
    currentRadius *= 0.85;
  }
  return totalInserted;
}

/**
 * Replaces a single grid cell with a tightly packed set of smaller cells.
 * @param settings - The active application settings.
 * @param cellId - The ID of the grid cell to split.
 * @returns The number of new grid cells created.
 */
export async function splitGridCell(
  settings: SettingsConfig,
  cellId: number
): Promise<number> {
  const cellToSplit = await db
    .select({
      id: gridCellSchema.id,
      lat: sql<number>`ST_Y(${gridCellSchema.center})`,
      lng: sql<number>`ST_X(${gridCellSchema.center})`,
      radius: gridCellSchema.radiusMeters,
      level: gridCellSchema.level,
    })
    .from(gridCellSchema)
    .where(eq(gridCellSchema.id, cellId))
    .limit(1);

  if (!cellToSplit.length) return 0;
  const originalCell = cellToSplit[0]!;

  // Remove the original cell to make space for the new, smaller ones
  await db.delete(gridCellSchema).where(eq(gridCellSchema.id, cellId));

  // The main function that orchestrates the packing and insertion process
  const newCircleCount = await generateAndInsertPackedCircles(settings, {
    center: { lng: originalCell.lng, lat: originalCell.lat },
    radius: originalCell.radius,
    level: originalCell.level,
  });

  console.log(
    `Split cell ${cellId}: removed 1 circle, added ${newCircleCount} new packed circles.`
  );
  return newCircleCount;
}