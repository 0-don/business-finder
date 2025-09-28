import { eq, sql, and, not } from "drizzle-orm";
import { db } from "../db";
import { gridCellSchema } from "../db/schema";
import { Point, SettingsConfig } from "../types";

interface Circle {
  center: Point;
  radius: number;
}

/**
 * Calculates the approximate distance between two points in meters.
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
 * Generates all potential hexagonal candidates, pre-filtered to be within the parent circle.
 */
function generateAllCandidates(
  parentCenter: Point,
  parentRadius: number,
  minRadius: number
): Circle[] {
  const allCandidates: Circle[] = [];
  let currentRadius = parentRadius / 2.5;

  while (currentRadius >= minRadius) {
    const dy = currentRadius * 1.5;
    const dx = currentRadius * 1.732;

    const latRadiusDegrees = parentRadius / 111320;
    const lngRadiusDegrees =
      parentRadius / (111320 * Math.cos((parentCenter.lat * Math.PI) / 180));

    const latStep = dy / 111320;
    let row = 0;

    for (
      let lat = parentCenter.lat - latRadiusDegrees;
      lat <= parentCenter.lat + latRadiusDegrees;
      lat += latStep
    ) {
      const lngStep = dx / (111320 * Math.cos((lat * Math.PI) / 180));
      const lngOffset =
        (currentRadius * 0.866) /
        (111320 * Math.cos((lat * Math.PI) / 180));
      const startLng =
        parentCenter.lng - lngRadiusDegrees + (row % 2 === 1 ? lngOffset : 0);

      for (
        let lng = startLng;
        lng <= parentCenter.lng + lngRadiusDegrees;
        lng += lngStep
      ) {
        const candidateCenter = { lng, lat };
        if (
          getApproximateDistance(candidateCenter, parentCenter) +
            currentRadius <=
          parentRadius
        ) {
          allCandidates.push({
            center: candidateCenter,
            radius: currentRadius,
          });
        }
      }
      row++;
    }
    currentRadius *= 0.85;
  }
  return allCandidates.sort((a, b) => b.radius - a.radius);
}

/**
 * Replaces a single grid cell with a tightly packed set of smaller cells.
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

  // Step 1: Fetch all nearby existing circles (obstacles) ONCE.
  const searchRadius = originalCell.radius * 3; // Search in a generous area
  const searchBounds = sql`ST_Expand(${sql.raw(`ST_SetSRID(ST_Point(${originalCell.lng}, ${originalCell.lat}), 4326)`)}::geometry, ${searchRadius / 111320})`;
  
  const obstacles = await db
    .select({
        center: {
            lng: sql<number>`ST_X(${gridCellSchema.center})`,
            lat: sql<number>`ST_Y(${gridCellSchema.center})`,
        },
        radius: gridCellSchema.radiusMeters
    })
    .from(gridCellSchema)
    .where(and(
        not(eq(gridCellSchema.id, cellId)), // Exclude the cell we are splitting
        sql`${gridCellSchema.center} && ${searchBounds}`
    ));

  // Step 2: Generate all potential candidates in memory.
  const allCandidates = generateAllCandidates(
    { lng: originalCell.lng, lat: originalCell.lat },
    originalCell.radius,
    settings.minRadius
  );

  // Step 3: Perform fast in-memory packing, checking against both new circles and existing obstacles.
  const packedCircles: Circle[] = [];
  for (const candidate of allCandidates) {
    let hasOverlap = false;

    // Check overlap against newly placed circles
    for (const placed of packedCircles) {
      if (getApproximateDistance(candidate.center, placed.center) < candidate.radius + placed.radius) {
        hasOverlap = true;
        break;
      }
    }
    if (hasOverlap) continue;

    // Check overlap against existing obstacles from the database
    for (const obstacle of obstacles) {
        if (getApproximateDistance(candidate.center, obstacle.center) < candidate.radius + obstacle.radius) {
            hasOverlap = true;
            break;
        }
    }

    if (!hasOverlap) {
      packedCircles.push(candidate);
    }
  }
  
  // Step 4: Delete the original cell, then perform a single bulk insert.
  await db.delete(gridCellSchema).where(eq(gridCellSchema.id, cellId));

  if (packedCircles.length > 0) {
    const valuesToInsert = packedCircles.map((circle) => ({
      center: sql`ST_SetSRID(ST_Point(${circle.center.lng}, ${circle.center.lat}), 4326)`,
      radiusMeters: circle.radius,
      circle: sql`ST_Buffer(ST_SetSRID(ST_Point(${circle.center.lng}, ${circle.center.lat}), 4326)::geography, ${circle.radius})::geometry`,
      level: originalCell.level + 1,
      countryCode: settings.countryCode,
    }));
    await db.insert(gridCellSchema).values(valuesToInsert);
  }

  const newCircleCount = packedCircles.length;
  console.log(
    `Split cell ${cellId}: removed 1 circle, added ${newCircleCount} new packed circles.`
  );
  return newCircleCount;
}