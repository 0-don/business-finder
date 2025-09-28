import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { gridCellSchema } from "../db/schema";
import { Point, SettingsConfig } from "../types";

interface Circle {
  center: Point;
  radius: number;
}

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

  // Generate packed circles
  const packedCircles = generateCirclePacking(
    { lng: originalCell.lng, lat: originalCell.lat },
    originalCell.radius,
    settings.minRadius
  );

  // Insert the new circles
  const values = packedCircles.map((circle, index) => ({
    center: sql`ST_Point(${circle.center.lng}, ${circle.center.lat}, 4326)`,
    radiusMeters: circle.radius,
    circle: sql`ST_Buffer(ST_Point(${circle.center.lng}, ${circle.center.lat}, 4326)::geography, ${circle.radius})::geometry`,
    level: originalCell.level + 1,
    countryCode: settings.countryCode,
  }));

  if (values.length > 0) {
    await db.insert(gridCellSchema).values(values);
  }

  console.log(
    `Split cell ${cellId}: removed 1 circle, added ${packedCircles.length} circles`
  );
  return packedCircles.length;
}

function generateCirclePacking(
  center: Point,
  maxRadius: number,
  minRadius: number
): Circle[] {
  const circles: Circle[] = [];
  const candidates: Circle[] = [];

  // Convert meters to approximate degrees (rough conversion for visualization)
  const metersToDegrees = (meters: number) => meters / 111320;

  const maxRadiusDeg = metersToDegrees(maxRadius);
  const minRadiusDeg = metersToDegrees(minRadius);

  // Start with the largest possible circle that fits
  let currentRadius = maxRadius * 0.4; // Start smaller to allow multiple circles

  while (currentRadius >= minRadius) {
    const radiusDeg = metersToDegrees(currentRadius);
    const placed = placeCirclesAtRadius(
      center,
      maxRadiusDeg,
      radiusDeg,
      circles
    );

    if (placed === 0) {
      currentRadius *= 0.8; // Reduce radius if no circles could be placed
      continue;
    }

    currentRadius *= 0.7; // Incrementally smaller radius
  }

  return circles;
}

function placeCirclesAtRadius(
  center: Point,
  maxRadiusDeg: number,
  radiusDeg: number,
  existingCircles: Circle[]
): number {
  let placed = 0;
  const attempts = 50; // Number of random placement attempts

  for (let i = 0; i < attempts; i++) {
    const angle = Math.random() * 2 * Math.PI;
    const distance = Math.random() * (maxRadiusDeg - radiusDeg * 2);

    const candidate: Point = {
      lng: center.lng + Math.cos(angle) * distance,
      lat: center.lat + Math.sin(angle) * distance,
    };

    // Check if this circle fits within the original boundary
    const distFromCenter = Math.sqrt(
      Math.pow(candidate.lng - center.lng, 2) +
        Math.pow(candidate.lat - center.lat, 2)
    );

    if (distFromCenter + radiusDeg > maxRadiusDeg) continue;

    // Check if it overlaps with existing circles
    let overlaps = false;
    for (const existing of existingCircles) {
      const existingRadiusDeg = existing.radius / 111320;
      const dist = Math.sqrt(
        Math.pow(candidate.lng - existing.center.lng, 2) +
          Math.pow(candidate.lat - existing.center.lat, 2)
      );

      if (dist < radiusDeg + existingRadiusDeg + 0.0001) {
        // Small buffer
        overlaps = true;
        break;
      }
    }

    if (!overlaps) {
      existingCircles.push({
        center: candidate,
        radius: radiusDeg * 111320, // Convert back to meters
      });
      placed++;

      // Limit circles per radius level
      if (placed >= 8) break;
    }
  }

  return placed;
}
