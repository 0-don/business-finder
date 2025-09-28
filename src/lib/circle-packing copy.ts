import { eq, sql, and, not } from "drizzle-orm";
import { db } from "../db";
import { gridCellSchema } from "../db/schema";
import { Point, SettingsConfig } from "../types";

interface Circle {
  center: Point;
  radius: number;
}

interface IndexedCircle extends Circle {
  gridX: number;
  gridY: number;
}

/**
 * Fast approximate distance calculation (no square root)
 */
function getApproximateDistanceSquared(p1: Point, p2: Point): number {
  const R = 6371e3;
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

  return (R * c) * (R * c); // Return squared distance to avoid sqrt
}

/**
 * Spatial grid for fast collision detection
 */
class SpatialGrid {
  private grid: Map<string, IndexedCircle[]> = new Map();
  private cellSize: number;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  private getGridKey(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
  }

  private getGridCoords(point: Point): { x: number, y: number } {
    // Convert lat/lng to approximate meters for grid indexing
    const x = point.lng * 111320 * Math.cos((point.lat * Math.PI) / 180);
    const y = point.lat * 111320;
    return { x, y };
  }

  add(circle: Circle): void {
    const coords = this.getGridCoords(circle.center);
    const gridX = Math.floor(coords.x / this.cellSize);
    const gridY = Math.floor(coords.y / this.cellSize);
    
    const indexedCircle: IndexedCircle = {
      ...circle,
      gridX,
      gridY
    };

    // Add to all grid cells that this circle might overlap
    const radius = circle.radius;
    const cellRadius = Math.ceil(radius / this.cellSize);
    
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        const key = this.getGridKey(
          (gridX + dx) * this.cellSize,
          (gridY + dy) * this.cellSize
        );
        
        if (!this.grid.has(key)) {
          this.grid.set(key, []);
        }
        this.grid.get(key)!.push(indexedCircle);
      }
    }
  }

  getNearby(point: Point, radius: number): IndexedCircle[] {
    const coords = this.getGridCoords(point);
    const nearby: IndexedCircle[] = [];
    const seen = new Set<IndexedCircle>();
    
    const cellRadius = Math.ceil(radius / this.cellSize);
    const gridX = Math.floor(coords.x / this.cellSize);
    const gridY = Math.floor(coords.y / this.cellSize);
    
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        const key = this.getGridKey(
          (gridX + dx) * this.cellSize,
          (gridY + dy) * this.cellSize
        );
        
        const cells = this.grid.get(key);
        if (cells) {
          for (const circle of cells) {
            if (!seen.has(circle)) {
              seen.add(circle);
              nearby.push(circle);
            }
          }
        }
      }
    }
    
    return nearby;
  }
}

/**
 * Find max radius without stack overflow
 */
function findMaxRadius(candidates: Circle[], obstacles: Circle[]): number {
  let maxRadius = 0;
  
  for (const candidate of candidates) {
    if (candidate.radius > maxRadius) {
      maxRadius = candidate.radius;
    }
  }
  
  for (const obstacle of obstacles) {
    if (obstacle.radius > maxRadius) {
      maxRadius = obstacle.radius;
    }
  }
  
  return maxRadius;
}

/**
 * Find min and max radius without stack overflow
 */
function findRadiusRange(candidates: Circle[]): { min: number, max: number } {
  let min = Infinity;
  let max = -Infinity;
  
  for (const candidate of candidates) {
    if (candidate.radius < min) min = candidate.radius;
    if (candidate.radius > max) max = candidate.radius;
  }
  
  return { min, max };
}

/**
 * Optimized candidate generation that ensures all circles down to minRadius are generated
 */
function generateOptimizedCandidates(
  parentCenter: Point,
  parentRadius: number,
  minRadius: number
): Circle[] {
  const startTime = performance.now();
  
  const allCandidates: Circle[] = [];
  let currentRadius = parentRadius / 2.5;

  // Pre-calculate parent bounds for faster filtering
  const parentRadiusDegLat = parentRadius / 111320;
  const parentRadiusDegLng = parentRadius / (111320 * Math.cos((parentCenter.lat * Math.PI) / 180));

  while (currentRadius >= minRadius) {
    const dy = currentRadius * 1.5;
    const dx = currentRadius * 1.732;

    const latStep = dy / 111320;
    const lngStepBase = dx / 111320;
    let row = 0;

    for (
      let lat = parentCenter.lat - parentRadiusDegLat;
      lat <= parentCenter.lat + parentRadiusDegLat;
      lat += latStep
    ) {
      const lngStep = lngStepBase / Math.cos((lat * Math.PI) / 180);
      const lngOffset = (currentRadius * 0.866) / (111320 * Math.cos((lat * Math.PI) / 180));
      const startLng = parentCenter.lng - parentRadiusDegLng + (row % 2 === 1 ? lngOffset : 0);

      for (
        let lng = startLng;
        lng <= parentCenter.lng + parentRadiusDegLng;
        lng += lngStep
      ) {
        const candidateCenter = { lng, lat };
        
        // Fast distance check using squared distance
        const distSquared = getApproximateDistanceSquared(candidateCenter, parentCenter);
        const maxDistSquared = (parentRadius - currentRadius) * (parentRadius - currentRadius);
        
        if (distSquared <= maxDistSquared) {
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
  const radiusRange = findRadiusRange(allCandidates);
  
  console.log(`  ⏱️  Generated ${allCandidates.length} candidates in ${(endTime - startTime).toFixed(2)}ms`);
  console.log(`  📏 Radius range: ${radiusRange.max.toFixed(0)}m to ${radiusRange.min.toFixed(0)}m`);
  
  // Sort by radius (largest first) for better packing
  return allCandidates.sort((a, b) => b.radius - a.radius);
}

/**
 * Optimized circle packing with spatial indexing
 */
function packCirclesOptimized(
  candidates: Circle[],
  obstacles: Circle[]
): Circle[] {
  const packingStart = performance.now();
  console.log(`  🔍 Starting optimized circle packing...`);
  
  // Find max radius safely
  const maxRadius = findMaxRadius(candidates, obstacles);
  const spatialGrid = new SpatialGrid(maxRadius * 2);
  
  // Index obstacles first
  console.log(`  🚧 Indexing ${obstacles.length} obstacles...`);
  const obstacleIndexStart = performance.now();
  for (const obstacle of obstacles) {
    spatialGrid.add(obstacle);
  }
  const obstacleIndexEnd = performance.now();
  console.log(`    ✅ Obstacles indexed in ${(obstacleIndexEnd - obstacleIndexStart).toFixed(2)}ms`);
  
  const packedCircles: Circle[] = [];
  let rejectedByObstacles = 0;
  let spatialChecks = 0;
  let totalDistanceChecks = 0;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!; // We know this exists
    let hasOverlap = false;

    // Get nearby circles using spatial indexing
    const nearby = spatialGrid.getNearby(candidate.center, candidate.radius);
    spatialChecks++;
    
    // Check against nearby circles only
    for (const nearbyCircle of nearby) {
      totalDistanceChecks++;
      const distSquared = getApproximateDistanceSquared(candidate.center, nearbyCircle.center);
      const minDistSquared = (candidate.radius + nearbyCircle.radius) * (candidate.radius + nearbyCircle.radius);
      
      if (distSquared < minDistSquared) {
        hasOverlap = true;
        rejectedByObstacles++;
        break;
      }
    }

    if (!hasOverlap) {
      packedCircles.push(candidate);
      spatialGrid.add(candidate);
      
      // Log progress every 500 successful placements
      if (packedCircles.length % 500 === 0) {
        console.log(`    ✅ Placed ${packedCircles.length} circles so far... (${((i / candidates.length) * 100).toFixed(1)}% through candidates)`);
      }
    }
  }

  const packingEnd = performance.now();
  console.log(`  📦 Optimized circle packing completed in ${(packingEnd - packingStart).toFixed(2)}ms`);
  console.log(`    - Placed: ${packedCircles.length} circles`);
  console.log(`    - Rejected by obstacles: ${rejectedByObstacles}`);
  console.log(`    - Total candidates processed: ${candidates.length}`);
  console.log(`    - Spatial grid lookups: ${spatialChecks}`);
  console.log(`    - Distance calculations: ${totalDistanceChecks} (avg ${(totalDistanceChecks / candidates.length).toFixed(1)} per candidate)`);
  
  return packedCircles;
}

/**
 * Optimized splitGridCell function
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

  // Step 2: Fetch nearby existing circles (obstacles) with optimized query
  const obstaclesStart = performance.now();
  const searchRadius = originalCell.radius * 3;
  
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
        not(eq(gridCellSchema.id, cellId)),
        sql`ST_DWithin(${gridCellSchema.center}::geography, ST_Point(${originalCell.lng}, ${originalCell.lat})::geography, ${searchRadius})`
    ));

  const obstaclesEnd = performance.now();
  console.log(`  🚧 Fetched ${obstacles.length} obstacle circles in ${(obstaclesEnd - obstaclesStart).toFixed(2)}ms (search radius: ${searchRadius.toFixed(0)}m)`);

  // Step 3: Generate optimized candidates
  console.log(`  🎯 Generating optimized candidates...`);
  const allCandidates = generateOptimizedCandidates(
    { lng: originalCell.lng, lat: originalCell.lat },
    originalCell.radius,
    settings.minRadius,
  );

  // Step 4: Optimized circle packing
  const packedCircles = packCirclesOptimized(allCandidates, obstacles);

  // Step 5: Database operations
  const dbOpsStart = performance.now();
  console.log(`  🗑️  Deleting original cell...`);
  
  const deleteStart = performance.now();
  await db.delete(gridCellSchema).where(eq(gridCellSchema.id, cellId));
  const deleteEnd = performance.now();
  console.log(`    ✅ Deleted in ${(deleteEnd - deleteStart).toFixed(2)}ms`);

  if (packedCircles.length > 0) {
    console.log(`  💾 Inserting ${packedCircles.length} new circles...`);
    const insertStart = performance.now();
    
    // Batch insert for better performance
    const batchSize = 1000;
    for (let i = 0; i < packedCircles.length; i += batchSize) {
      const batch = packedCircles.slice(i, i + batchSize);
      const valuesToInsert = batch.map((circle) => ({
        center: sql`ST_SetSRID(ST_Point(${circle.center.lng}, ${circle.center.lat}), 4326)`,
        radiusMeters: circle.radius,
        circle: sql`ST_Buffer(ST_SetSRID(ST_Point(${circle.center.lng}, ${circle.center.lat}), 4326)::geography, ${circle.radius})::geometry`,
        level: originalCell.level + 1,
        countryCode: settings.countryCode,
      }));
      
      await db.insert(gridCellSchema).values(valuesToInsert);
      
      if (packedCircles.length > batchSize) {
        console.log(`    📦 Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(packedCircles.length / batchSize)}`);
      }
    }
    
    const insertEnd = performance.now();
    console.log(`    ✅ All inserts completed in ${(insertEnd - insertStart).toFixed(2)}ms`);
  }

  const dbOpsEnd = performance.now();
  console.log(`  💽 Database operations completed in ${(dbOpsEnd - dbOpsStart).toFixed(2)}ms`);

  const totalEndTime = performance.now();
  const totalTime = totalEndTime - totalStartTime;
  
  console.log(`🎉 Split cell ${cellId} completed in ${totalTime.toFixed(2)}ms:`);
  console.log(`   - Removed: 1 circle (radius: ${originalCell.radius}m)`);
  console.log(`   - Added: ${packedCircles.length} circles`);
  console.log(`   - Net change: ${packedCircles.length - 1} circles`);
  
  return packedCircles.length;
}