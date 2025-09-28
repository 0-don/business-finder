import { and, eq, not, sql } from "drizzle-orm";
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
  const startTime = performance.now();
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
        (currentRadius * 0.866) / (111320 * Math.cos((lat * Math.PI) / 180));
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
  
  const endTime = performance.now();
  console.log(`  ⏱️  Generated ${allCandidates.length} candidates in ${(endTime - startTime).toFixed(2)}ms`);
  
  return allCandidates.sort((a, b) => b.radius - a.radius);
}

/**
 * Replaces a single grid cell with a tightly packed set of smaller cells.
 */
export async function splitGridCell(
  settings: SettingsConfig,
  cellId: number
): Promise<number> {
  const totalStartTime = performance.now();
  console.log(`🔄 Starting splitGridCell for cell ID: ${cellId}`);

  // Step 1: Fetch the cell to split
  const fetchCellStart = performance.now();
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

  const fetchCellEnd = performance.now();
  console.log(`  📍 Fetched cell data in ${(fetchCellEnd - fetchCellStart).toFixed(2)}ms`);

  if (!cellToSplit.length) {
    console.log(`  ❌ Cell ${cellId} not found`);
    return 0;
  }
  const originalCell = cellToSplit[0]!;
  console.log(`  📏 Original cell: radius=${originalCell.radius}m, level=${originalCell.level}, pos=(${originalCell.lat.toFixed(4)}, ${originalCell.lng.toFixed(4)})`);

  // Step 2: Fetch all nearby existing circles (obstacles)
  const obstaclesStart = performance.now();
  const searchRadius = originalCell.radius * 3;
  const searchBounds = sql`ST_Expand(${sql.raw(`ST_SetSRID(ST_Point(${originalCell.lng}, ${originalCell.lat}), 4326)`)}::geometry, ${searchRadius / 111320})`;

  const obstacles = await db
    .select({
      center: {
        lng: sql<number>`ST_X(${gridCellSchema.center})`,
        lat: sql<number>`ST_Y(${gridCellSchema.center})`,
      },
      radius: gridCellSchema.radiusMeters,
    })
    .from(gridCellSchema)
    .where(
      and(
        not(eq(gridCellSchema.id, cellId)),
        sql`${gridCellSchema.center} && ${searchBounds}`
      )
    );

  const obstaclesEnd = performance.now();
  console.log(`  🚧 Fetched ${obstacles.length} obstacle circles in ${(obstaclesEnd - obstaclesStart).toFixed(2)}ms (search radius: ${searchRadius.toFixed(0)}m)`);

  // Step 3: Generate all potential candidates
  console.log(`  🎯 Generating candidates...`);
  const allCandidates = generateAllCandidates(
    { lng: originalCell.lng, lat: originalCell.lat },
    originalCell.radius,
    settings.minRadius
  );

  // Step 4: Circle packing
  const packingStart = performance.now();
  console.log(`  🔍 Starting circle packing...`);
  const packedCircles: Circle[] = [];
  let rejectedByNew = 0;
  let rejectedByObstacles = 0;

  for (const candidate of allCandidates) {
    let hasOverlap = false;

    // Check overlap against newly placed circles
    for (const placed of packedCircles) {
      if (
        getApproximateDistance(candidate.center, placed.center) <
        candidate.radius + placed.radius
      ) {
        hasOverlap = true;
        rejectedByNew++;
        break;
      }
    }
    if (hasOverlap) continue;

    // Check overlap against existing obstacles from the database
    for (const obstacle of obstacles) {
      if (
        getApproximateDistance(candidate.center, obstacle.center) <
        candidate.radius + obstacle.radius
      ) {
        hasOverlap = true;
        rejectedByObstacles++;
        break;
      }
    }

    if (!hasOverlap) {
      packedCircles.push(candidate);
      
      // Log progress every 1000 successful placements
      if (packedCircles.length % 1000 === 0) {
        console.log(`    ✅ Placed ${packedCircles.length} circles so far...`);
      }
    }
  }

  const packingEnd = performance.now();
  console.log(`  📦 Circle packing completed in ${(packingEnd - packingStart).toFixed(2)}ms`);
  console.log(`    - Placed: ${packedCircles.length} circles`);
  console.log(`    - Rejected by new circles: ${rejectedByNew}`);
  console.log(`    - Rejected by obstacles: ${rejectedByObstacles}`);

  // Step 5: Database operations
  const dbOpsStart = performance.now();
  console.log(`  🗑️  Deleting original cell...`);
  await db.delete(gridCellSchema).where(eq(gridCellSchema.id, cellId));

  if (packedCircles.length > 0) {
    console.log(`  💾 Inserting ${packedCircles.length} new circles...`);
    const valuesToInsert = packedCircles.map((circle) => ({
      center: sql`ST_SetSRID(ST_Point(${circle.center.lng}, ${circle.center.lat}), 4326)`,
      radiusMeters: circle.radius,
      circle: sql`ST_Buffer(ST_SetSRID(ST_Point(${circle.center.lng}, ${circle.center.lat}), 4326)::geography, ${circle.radius})::geometry`,
      level: originalCell.level + 1,
      countryCode: settings.countryCode,
    }));
    await db.insert(gridCellSchema).values(valuesToInsert);
  }

  const dbOpsEnd = performance.now();
  const totalTime = performance.now() - totalStartTime;

  console.log(`🎉 Split cell ${cellId} completed in ${totalTime.toFixed(2)}ms:`);
  console.log(`   - Removed: 1 circle (radius: ${originalCell.radius}m)`);
  console.log(`   - Added: ${packedCircles.length} circles`);
  console.log(`   - Performance breakdown:`);
  console.log(`     * Cell fetch: ${(fetchCellEnd - fetchCellStart).toFixed(2)}ms`);
  console.log(`     * Obstacle fetch: ${(obstaclesEnd - obstaclesStart).toFixed(2)}ms`);
  console.log(`     * Candidate generation: ${(packingStart - obstaclesEnd).toFixed(2)}ms`);
  console.log(`     * Circle packing: ${(packingEnd - packingStart).toFixed(2)}ms`);
  console.log(`     * Database ops: ${(dbOpsEnd - dbOpsStart).toFixed(2)}ms`);

  return packedCircles.length;
}