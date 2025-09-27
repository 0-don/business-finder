import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { count, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { countries, gridCellSchema } from "../db/schema";
import { BoundsResult, ValidPosition } from "../types";
import { latSpacing } from "./constants";

dayjs.extend(relativeTime);

const BATCH_SIZE = 1000;

export class GridManager {
  countryCode: string;

  constructor(countryCode: string) {
    this.countryCode = countryCode;
  }

  async getLastProcessedLevel(): Promise<number | null> {
    const result = await db
      .select({
        maxLevel: sql<number>`MAX(level)`,
      })
      .from(gridCellSchema)
      .limit(1);
    return result[0]?.maxLevel ?? null;
  }

  async initializeCountryGrid(initialRadius: number = 50000): Promise<void> {
    const startTime = dayjs();
    console.log(`Initializing grid for ${this.countryCode}...`);

    const bounds = await this.getCountryBounds();

    // Check what level we left off at
    const lastLevel = await this.getLastProcessedLevel();
    let startRadius = initialRadius;

    if (lastLevel !== null) {
      startRadius = 50000 - lastLevel * 100;
      console.log(`Resuming from level ${lastLevel}, radius ${startRadius}m`);
    }

    // Generate radii from where we left off, but stop at 200m
    // No point trying 100m since larger circles should fill all space
    const radii = Array.from(
      { length: Math.max(0, (startRadius - 200) / 100 + 1) },
      (_, i) => startRadius - i * 100
    ).filter((r) => r >= 200);

    if (radii.length === 0) {
      console.log("Grid generation complete - all radii processed");
      return;
    }

    let totalPlaced =
      (await db.select({ count: count() }).from(gridCellSchema))[0]?.count || 0;

    for (const radius of radii) {
      const placed = await this.processRadiusOptimized(bounds, radius);
      totalPlaced += placed;
      console.log(
        `Radius ${radius}m: ${placed} circles (total: ${totalPlaced}) - ${startTime.fromNow()}`
      );
    }

    console.log(
      `Grid complete: ${totalPlaced} circles - ${startTime.fromNow()}`
    );
  }

  private async processRadiusOptimized(
    bounds: BoundsResult,
    radius: number
  ): Promise<number> {
    const validPositions = (await db.execute(sql`
      WITH RECURSIVE
      grid_bounds AS (
        SELECT 
          ${bounds.min_lat}::numeric as min_lat,
          ${bounds.max_lat}::numeric as max_lat,
          ${bounds.min_lng}::numeric as min_lng,
          ${bounds.max_lng}::numeric as max_lng,
          ${latSpacing(radius)}::numeric as lat_spacing,
          ${radius}::integer as radius
      ),
      country_geom AS (
        SELECT geometry FROM countries WHERE iso_a3 = ${this.countryCode}
      ),
      lat_points AS (
        SELECT generate_series(min_lat, max_lat, lat_spacing) as lat
        FROM grid_bounds
      ),
      potential_points AS (
        SELECT 
          lp.lat,
          generate_series(
            gb.min_lng,
            gb.max_lng,
            calculate_lng_spacing(lp.lat, gb.radius * 2)
          ) as lng,
          gb.radius
        FROM lat_points lp, grid_bounds gb
      ),
      candidate_circles AS (
        SELECT 
          pp.lat, 
          pp.lng,
          ST_Buffer(ST_Point(pp.lng, pp.lat, 4326)::geography, pp.radius)::geometry as new_circle
        FROM potential_points pp, country_geom cg
        WHERE ST_Contains(cg.geometry, ST_Point(pp.lng, pp.lat, 4326))
      )
      SELECT cc.lat, cc.lng
      FROM candidate_circles cc, country_geom cg
      WHERE ST_Contains(cg.geometry, cc.new_circle)
        AND NOT EXISTS (
          SELECT 1 FROM grid_cell gc
          WHERE ST_Intersects(gc.circle_geometry, cc.new_circle)
        )
      ORDER BY cc.lat, cc.lng
    `)) as unknown as ValidPosition[];

    if (validPositions.length === 0) return 0;

    const level = Math.floor((50000 - radius) / 100);

    // Process in batches to avoid stack overflow
    let totalInserted = 0;
    for (let i = 0; i < validPositions.length; i += BATCH_SIZE) {
      const batch = validPositions.slice(i, i + BATCH_SIZE);
      const gridCells = batch.map((pos) => ({
        latitude: pos.lat.toString(),
        longitude: pos.lng.toString(),
        radius,
        circleGeometry: sql`ST_Buffer(ST_Point(${pos.lng}, ${pos.lat}, 4326)::geography, ${radius})::geometry`,
        level,
      }));

      await db.insert(gridCellSchema).values(gridCells);
      totalInserted += batch.length;
    }

    return totalInserted;
  }

  async getCountryGeometry() {
    const result = await db
      .select({
        geojson: sql<string>`ST_AsGeoJSON(geometry)`,
      })
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
