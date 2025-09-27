// src/lib/grid-manager.ts
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { count, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { countries, gridCellSchema } from "../db/schema";
import { BoundsResult, ValidPosition } from "../types";
import { latSpacing } from "./constants";

dayjs.extend(relativeTime);

const BATCH_SIZE = 1000;
const MIN_RADIUS = 100; // 100 meters minimum
const MAX_RADIUS = 50000; // 50km maximum
const MIN_PLACEMENT_THRESHOLD = 10; // Stop if fewer than 10 circles can be placed
const MAX_LEVELS = 100; // Safety limit to prevent infinite loops

interface PackingLevel {
  radius: number;
  level: number;
}

export class GridManager {
  countryCode: string;

  constructor(countryCode: string) {
    this.countryCode = countryCode;
  }

  private calculateAdaptivePackingLevels(): PackingLevel[] {
    const levels: PackingLevel[] = [];
    let currentRadius = MAX_RADIUS;
    let level = 0;

    // Start with larger steps, then get more granular
    while (currentRadius >= MIN_RADIUS && level < MAX_LEVELS) {
      levels.push({
        radius: Math.round(currentRadius),
        level: level,
      });

      // Adaptive step calculation - larger steps at higher radii, smaller at lower
      let stepFactor: number;
      if (currentRadius > 10000) {
        stepFactor = 0.75; // 25% reduction for large radii
      } else if (currentRadius > 2000) {
        stepFactor = 0.85; // 15% reduction for medium radii
      } else if (currentRadius > 500) {
        stepFactor = 0.9; // 10% reduction for smaller radii
      } else {
        // Fine-grained at small radii - reduce by fixed amounts
        const reduction = Math.max(10, Math.floor(currentRadius * 0.05));
        currentRadius -= reduction;
        level++;
        continue;
      }

      currentRadius *= stepFactor;
      level++;
    }

    // Ensure we hit the minimum radius exactly
    if (levels[levels.length - 1]!.radius > MIN_RADIUS) {
      levels.push({
        radius: MIN_RADIUS,
        level: level,
      });
    }

    return levels;
  }

  // Alternative: Dynamic radius calculation based on remaining gaps
  private async calculateNextOptimalRadius(
    currentLevel: number
  ): Promise<number | null> {
    // Find the largest gap that can fit a circle
    const result = (await db.execute(sql`
      WITH country_geom AS (
        SELECT geometry FROM countries WHERE iso_a3 = ${this.countryCode}
      ),
      existing_circles AS (
        SELECT circle_geometry FROM grid_cell
      ),
      gap_analysis AS (
        SELECT 
          ST_X(pt.geom) as lng,
          ST_Y(pt.geom) as lat,
          COALESCE(
            MIN(ST_Distance(pt.geom::geography, ST_Centroid(ec.circle_geometry)::geography)) - 
            MIN(CASE WHEN gc.radius IS NOT NULL THEN gc.radius ELSE 0 END), 
            ${MAX_RADIUS}
          ) as available_radius
        FROM (
          SELECT (ST_DumpPoints(
            ST_GeneratePoints((SELECT geometry FROM country_geom), 1000)
          )).geom
        ) pt
        LEFT JOIN existing_circles ec ON ST_DWithin(pt.geom::geography, ST_Centroid(ec.circle_geometry)::geography, 100)
        LEFT JOIN grid_cell gc ON ec.circle_geometry = gc.circle_geometry
        WHERE ST_Contains((SELECT geometry FROM country_geom), pt.geom)
        GROUP BY pt.geom
        HAVING COALESCE(
          MIN(ST_Distance(pt.geom::geography, ST_Centroid(ec.circle_geometry)::geography)) - 
          MIN(CASE WHEN gc.radius IS NOT NULL THEN gc.radius ELSE 0 END), 
          ${MAX_RADIUS}
        ) >= ${MIN_RADIUS}
        ORDER BY available_radius DESC
        LIMIT 1
      )
      SELECT GREATEST(${MIN_RADIUS}, LEAST(available_radius, ${MAX_RADIUS})) as optimal_radius
      FROM gap_analysis
    `)) as unknown as Array<{ optimal_radius: number }>;

    return result[0]?.optimal_radius ?? null;
  }

  async initializeCountryGrid(): Promise<void> {
    const startTime = dayjs();
    console.log(`Initializing adaptive grid for ${this.countryCode}...`);

    const bounds = await this.getCountryBounds();
    const packingLevels = this.calculateAdaptivePackingLevels();

    console.log(`Processing ${packingLevels.length} adaptive packing levels`);

    let totalPlaced = await this.getTotalCircleCount();
    const lastRadius = await this.getLastProcessedRadius();
    const startIndex = lastRadius
      ? packingLevels.findIndex((level) => level.radius <= lastRadius)
      : 0;

    if (startIndex > 0) {
      console.log(
        `Resuming from level ${startIndex} (${packingLevels[startIndex]?.radius}m)`
      );
    }

    for (let i = startIndex; i < packingLevels.length; i++) {
      const level = packingLevels[i]!;
      const placed = await this.processLevel(bounds, level);
      totalPlaced += placed;

      console.log(
        `Level ${level.level} (${level.radius}m): ${placed} circles (total: ${totalPlaced}) - ${startTime.fromNow()}`
      );

      // Stop early if we're not placing enough circles to justify continuing
      if (placed < MIN_PLACEMENT_THRESHOLD && level.radius <= 1000) {
        console.log(
          `Stopping early - only ${placed} circles placed at ${level.radius}m radius`
        );
        break;
      }
    }

    // Optional: Fill remaining gaps with dynamic radius calculation
    await this.fillRemainingGaps(bounds, totalPlaced, startTime);

    console.log(
      `Grid complete: ${totalPlaced} circles - ${startTime.fromNow()}`
    );
  }

  private async fillRemainingGaps(
    bounds: BoundsResult,
    totalPlaced: number,
    startTime: dayjs.Dayjs
  ): Promise<void> {
    console.log("Filling remaining gaps with optimal radius calculation...");

    let level = 1000; // Start high level for gap filling
    let gapsFilled = 0;

    while (true) {
      const optimalRadius = await this.calculateNextOptimalRadius(level);

      if (!optimalRadius || optimalRadius < MIN_RADIUS) {
        break;
      }

      const placed = await this.processLevel(bounds, {
        radius: optimalRadius,
        level: level,
      });
      gapsFilled += placed;

      if (placed < MIN_PLACEMENT_THRESHOLD) {
        break;
      }

      console.log(
        `Gap fill level ${level} (${optimalRadius}m): ${placed} circles - ${startTime.fromNow()}`
      );
      level++;

      if (level > MAX_LEVELS + 1000) break; // Safety break
    }

    if (gapsFilled > 0) {
      console.log(
        `Gap filling complete: ${gapsFilled} additional circles placed`
      );
    }
  }

  private async processLevel(
    bounds: BoundsResult,
    level: PackingLevel
  ): Promise<number> {
    const spacing = latSpacing(level.radius);

    const validPositions = (await db.execute(sql`
      WITH RECURSIVE
      country_geom AS (
        SELECT geometry FROM countries WHERE iso_a3 = ${this.countryCode}
      ),
      grid_points AS (
        SELECT 
          lat_series.lat,
          lng_series.lng
        FROM generate_series(
          ${bounds.min_lat}::numeric,
          ${bounds.max_lat}::numeric,
          ${spacing}::numeric
        ) AS lat_series(lat)
        CROSS JOIN LATERAL generate_series(
          ${bounds.min_lng}::numeric,
          ${bounds.max_lng}::numeric,
          calculate_lng_spacing(lat_series.lat, ${level.radius * 2})
        ) AS lng_series(lng)
        WHERE ST_Contains(
          (SELECT geometry FROM country_geom),
          ST_Point(lng_series.lng, lat_series.lat, 4326)
        )
      ),
      candidate_circles AS (
        SELECT 
          gp.lat,
          gp.lng,
          ST_Buffer(ST_Point(gp.lng, gp.lat, 4326)::geography, ${level.radius}::numeric)::geometry as circle_geom
        FROM grid_points gp
      )
      SELECT cc.lat, cc.lng
      FROM candidate_circles cc
      WHERE ST_Contains(
        (SELECT geometry FROM country_geom),
        cc.circle_geom
      )
      AND NOT EXISTS (
        SELECT 1 FROM grid_cell gc
        WHERE ST_Intersects(gc.circle_geometry, cc.circle_geom)
      )
      ORDER BY cc.lat, cc.lng
      LIMIT 10000
    `)) as unknown as ValidPosition[];

    if (validPositions.length === 0) return 0;

    let totalInserted = 0;
    for (let i = 0; i < validPositions.length; i += BATCH_SIZE) {
      const batch = validPositions.slice(i, i + BATCH_SIZE);
      const gridCells = batch.map((pos) => ({
        latitude: pos.lat.toString(),
        longitude: pos.lng.toString(),
        radius: level.radius,
        circleGeometry: sql`ST_Buffer(ST_Point(${pos.lng}, ${pos.lat}, 4326)::geography, ${level.radius}::numeric)::geometry`,
        level: level.level,
      }));

      try {
        await db.insert(gridCellSchema).values(gridCells);
        totalInserted += gridCells.length;
      } catch (error) {
        // Handle overlaps by inserting one by one
        for (const cell of gridCells) {
          try {
            await db.insert(gridCellSchema).values([cell]);
            totalInserted++;
          } catch {
            // Skip overlapping circles
          }
        }
      }
    }

    return totalInserted;
  }

  async getLastProcessedRadius(): Promise<number | null> {
    const result = await db
      .select({ minRadius: sql<number>`MIN(radius)` })
      .from(gridCellSchema)
      .limit(1);
    return result[0]?.minRadius ?? null;
  }

  async getTotalCircleCount(): Promise<number> {
    const result = await db.select({ count: count() }).from(gridCellSchema);
    return result[0]?.count || 0;
  }

  async getCountryGeometry() {
    const result = await db
      .select({ geojson: sql<string>`ST_AsGeoJSON(geometry)` })
      .from(countries)
      .where(eq(countries.isoA3, this.countryCode))
      .limit(1);
    return result[0]?.geojson ? JSON.parse(result[0].geojson) : null;
  }

  private async getCountryBounds(): Promise<BoundsResult> {
    const result = await db
      .select({
        min_lng: sql<number>`ST_XMin(geometry)`,
        min_lat: sql<number>`ST_YMin(geometry)`,
        max_lng: sql<number>`ST_XMax(geometry)`,
        max_lat: sql<number>`ST_YMax(geometry)`,
      })
      .from(countries)
      .where(eq(countries.isoA3, this.countryCode))
      .limit(1);
    return result[0]!;
  }

  async clearGrid(): Promise<void> {
    console.log("Clearing existing grid...");
    await db.delete(gridCellSchema);
    console.log("Grid cleared");
  }

  async showLevelStats(): Promise<void> {
    const stats = await db
      .select({
        level: gridCellSchema.level,
        radius: sql<number>`MIN(radius)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(gridCellSchema)
      .groupBy(gridCellSchema.level)
      .orderBy(gridCellSchema.level);

    console.log("Grid Level Stats:");
    for (const stat of stats) {
      console.log(
        `Level ${stat.level} (Radius: ${stat.radius}m): ${stat.count} circles`
      );
    }
  }
}
