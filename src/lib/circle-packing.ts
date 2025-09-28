import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { gridCellSchema } from "../db/schema";
import { Point, SettingsConfig } from "../types";

interface Circle {
  center: Point;
  radius: number;
}

/**
 * Calculates the approximate distance in meters between two geographical points.
 * NOTE: This is a simplified equirectangular approximation, suitable for
 * relative distance checks within a small area.
 * @param p1 - The first point.
 * @param p2 - The second point.
 * @returns The approximate distance in meters.
 */
function getApproximateDistance(p1: Point, p2: Point): number {
  const R = 6371e3; // Earth's radius in meters
  const radLat1 = (p1.lat * Math.PI) / 180;
  const radLat2 = (p2.lat * Math.PI) / 180;
  const deltaLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const deltaLng = ((p2.lng - p1.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(radLat1) *
      Math.cos(radLat2) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
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
    const dx = metersToLngDegrees(candidateRadius * 1.732, lat); // 2 * radius * sin(60)
    const xOffset = metersToLngDegrees(candidateRadius * 0.866, lat); // radius * cos(60)
    const startLng = searchBounds.minLng + (row % 2 === 1 ? xOffset : 0);

    for (let lng = startLng; lng <= searchBounds.maxLng; lng += dx) {
      candidates.push({ lng, lat });
    }
    row++;
  }
  return candidates;
}

/**
 * Generates a tight packing of smaller circles within a larger circle's boundary.
 * @param originalCenter - The center of the circle to fill.
 * @param originalRadius - The radius of the circle to fill.
 * @param minRadius - The minimum radius for the new circles.
 * @returns An array of new, tightly packed circles.
 */
function generateCirclePacking(
  originalCenter: Point,
  originalRadius: number,
  minRadius: number
): Circle[] {
  const placedCircles: Circle[] = [];
  // Start with a radius that allows for multiple circles to be packed
  let currentRadius = originalRadius / 2.5;

  while (currentRadius >= minRadius) {
    const candidates = generateHexCandidates(
      originalCenter,
      originalRadius,
      currentRadius
    );

    for (const candidateCenter of candidates) {
      // 1. Check if the new circle is fully inside the original one
      const distFromCenter = getApproximateDistance(
        candidateCenter,
        originalCenter
      );
      if (distFromCenter + currentRadius > originalRadius) {
        continue;
      }

      // 2. Check for overlap with already placed circles
      let overlaps = false;
      for (const placed of placedCircles) {
        const distBetween = getApproximateDistance(
          candidateCenter,
          placed.center
        );
        if (distBetween < currentRadius + placed.radius) {
          overlaps = true;
          break;
        }
      }

      if (!overlaps) {
        placedCircles.push({ center: candidateCenter, radius: currentRadius });
      }
    }

    // Decrease radius for the next, smaller layer of circles
    currentRadius *= 0.8;
  }

  return placedCircles;
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
  // Get the cell to split
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

  // Remove the original cell
  await db.delete(gridCellSchema).where(eq(gridCellSchema.id, cellId));

  // Generate new packed circles using the hexagonal algorithm
  const packedCircles = generateCirclePacking(
    { lng: originalCell.lng, lat: originalCell.lat },
    originalCell.radius,
    settings.minRadius
  );

  // Insert the new circles into the database
  if (packedCircles.length > 0) {
    const values = packedCircles.map((circle) => ({
      center: sql`ST_SetSRID(ST_Point(${circle.center.lng}, ${circle.center.lat}), 4326)`,
      radiusMeters: circle.radius,
      circle: sql`ST_Buffer(ST_SetSRID(ST_Point(${circle.center.lng}, ${circle.center.lat}), 4326)::geography, ${circle.radius})::geometry`,
      level: originalCell.level + 1,
      countryCode: settings.countryCode,
    }));

    await db.insert(gridCellSchema).values(values);
  }

  console.log(
    `Split cell ${cellId}: removed 1 circle, added ${packedCircles.length} new circles.`
  );
  return packedCircles.length;
}