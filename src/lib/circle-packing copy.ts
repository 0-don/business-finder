import { and, eq, not, sql } from "drizzle-orm";
import { db } from "../db";
import { gridCellSchema } from "../db/schema";
import { Point, SettingsConfig } from "../types";

interface Circle {
  center: Point;
  radius: number;
}

/**
 * Simple haversine distance calculation for fast in-memory checks
 */
function fastDistance(p1: Point, p2: Point): number {
  const R = 6371e3; // Earth's radius in meters
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  const dLng = (p2.lng - p1.lng) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/**
 * Generate hexagonal grid candidates in JavaScript with database validation
 */
function generateHexCandidates(
  parentCenter: Point,
  parentRadius: number,
  minRadius: number
): Circle[] {
  const allCandidates: Circle[] = [];
  let currentRadius = parentRadius / 2.5;

  while (currentRadius >= minRadius) {
    const dy = currentRadius * 1.5;
    const dx = currentRadius * 1.732;

    // Convert meters to degrees
    const latRadiusDegrees = parentRadius / 111320;
    const lngRadiusDegrees = parentRadius / (111320 * Math.cos((parentCenter.lat * Math.PI) / 180));

    const latStep = dy / 111320;
    let row = 0;

    for (
      let lat = parentCenter.lat - latRadiusDegrees;
      lat <= parentCenter.lat + latRadiusDegrees;
      lat += latStep
    ) {
      const lngStep = dx / (111320 * Math.cos((lat * Math.PI) / 180));
      const lngOffset = (currentRadius * 0.866) / (111320 * Math.cos((lat * Math.PI) / 180));
      const startLng = parentCenter.lng - lngRadiusDegrees + (row % 2 === 1 ? lngOffset : 0);

      for (
        let lng = startLng;
        lng <= parentCenter.lng + lngRadiusDegrees;
        lng += lngStep
      ) {
        const candidateCenter = { lng, lat };
        
        // Check if candidate fits within parent circle
        if (fastDistance(candidateCenter, parentCenter) + currentRadius <= parentRadius) {
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
 * Optimized circle packing using in-memory calculations and database for data operations
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

  // Step 1: Generate all candidates in JavaScript
  const candidates = generateHexCandidates(
    { lng: originalCell.lng, lat: originalCell.lat },
    originalCell.radius,
    settings.minRadius
  );

  // Step 2: Get existing obstacles using spatial query
  const obstacles = await db
    .select({
      lng: sql<number>`ST_X(${gridCellSchema.center})`,
      lat: sql<number>`ST_Y(${gridCellSchema.center})`,
      radius: gridCellSchema.radiusMeters,
    })
    .from(gridCellSchema)
    .where(
      and(
        not(eq(gridCellSchema.id, cellId)),
        eq(gridCellSchema.countryCode, settings.countryCode),
        sql`ST_DWithin(
          ${gridCellSchema.center}::geography, 
          ST_SetSRID(ST_Point(${originalCell.lng}, ${originalCell.lat}), 4326)::geography, 
          ${originalCell.radius * 3}
        )`
      )
    );

  // Step 3: Perform greedy packing using fast in-memory distance calculations
  const packedCircles: Circle[] = [];

  for (const candidate of candidates) {
    let hasOverlap = false;

    // Check against existing obstacles
    for (const obstacle of obstacles) {
      const distance = fastDistance(candidate.center, { lng: obstacle.lng, lat: obstacle.lat });
      if (distance < candidate.radius + obstacle.radius) {
        hasOverlap = true;
        break;
      }
    }

    if (hasOverlap) continue;

    // Check against already placed circles
    for (const placed of packedCircles) {
      const distance = fastDistance(candidate.center, placed.center);
      if (distance < candidate.radius + placed.radius) {
        hasOverlap = true;
        break;
      }
    }

    if (!hasOverlap) {
      packedCircles.push(candidate);
    }
  }

  // Step 4: Delete original and insert new circles in a transaction
  await db.transaction(async (tx) => {
    // Delete the original cell
    await tx.delete(gridCellSchema).where(eq(gridCellSchema.id, cellId));

    // Insert new packed circles in batches to avoid large queries
    if (packedCircles.length > 0) {
      const batchSize = 50;
      for (let i = 0; i < packedCircles.length; i += batchSize) {
        const batch = packedCircles.slice(i, i + batchSize);
        const valuesToInsert = batch.map((circle) => ({
          center: sql`ST_SetSRID(ST_Point(${circle.center.lng}, ${circle.center.lat}), 4326)`,
          radiusMeters: circle.radius,
          circle: sql`ST_Buffer(ST_SetSRID(ST_Point(${circle.center.lng}, ${circle.center.lat}), 4326)::geography, ${circle.radius})::geometry`,
          level: originalCell.level + 1,
          countryCode: settings.countryCode,
        }));
        
        await tx.insert(gridCellSchema).values(valuesToInsert);
      }
    }
  });

  const newCircleCount = packedCircles.length;
  console.log(
    `Split cell ${cellId}: removed 1 circle, added ${newCircleCount} new packed circles.`
  );
  
  return newCircleCount;
}