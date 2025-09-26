import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { gridCellSchema } from "../db/schema";
import { BoundsResult } from "../types";

dayjs.extend(relativeTime);

export class GridManager {
  countryCode: string;

  constructor(countryCode: string) {
    this.countryCode = countryCode;
  }

  async initializeCountryGrid(initialRadius: number = 50000): Promise<void> {
    const startTime = dayjs();
    console.log(`Initializing grid for ${this.countryCode}...`);

    const bounds = await this.getCountryBounds();

    const radii = Array.from(
      { length: (initialRadius - 100) / 100 + 1 },
      (_, i) => initialRadius - i * 100
    );

    let gridId = 1;
    let totalPlaced = 0;

    for (const radius of radii) {
      const placed = await this.processRadiusOptimized(bounds, radius, gridId);
      gridId += placed;
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
    radius: number,
    startId: number
  ): Promise<number> {
    const overlapFactor = 0.9999;
    const latSpacing = (radius * 2.0 * 360.0 * overlapFactor) / 40008000.0;

    const validPositions = await db.execute(sql`
    WITH RECURSIVE
    grid_bounds AS (
      SELECT 
        ${bounds.min_lat}::numeric as min_lat,
        ${bounds.max_lat}::numeric as max_lat,
        ${bounds.min_lng}::numeric as min_lng,
        ${bounds.max_lng}::numeric as max_lng,
        ${latSpacing}::numeric as lat_spacing,
        ${radius}::integer as radius,
        ${overlapFactor}::numeric as overlap_factor
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
          calculate_lng_spacing_overlapped(lp.lat, gb.radius * 2, gb.overlap_factor)
        ) as lng,
        gb.radius
      FROM lat_points lp, grid_bounds gb
    ),
    country_geom AS (
      SELECT geometry FROM countries WHERE iso_a3 = ${this.countryCode}
    )
    SELECT pp.lat, pp.lng
    FROM potential_points pp, country_geom cg
    WHERE ST_Contains(cg.geometry, ST_Point(pp.lng, pp.lat, 4326))
      AND ST_Contains(cg.geometry, 
        ST_Buffer(ST_Point(pp.lng, pp.lat, 4326)::geography, pp.radius)::geometry
      )
      AND NOT EXISTS (
        SELECT 1 FROM grid_cell gc
        WHERE ST_Intersects(
          gc.circle_geometry,
          ST_Buffer(ST_Point(pp.lng, pp.lat, 4326)::geography, pp.radius)::geometry
        )
        AND ST_Area(
          ST_Intersection(
            gc.circle_geometry,
            ST_Buffer(ST_Point(pp.lng, pp.lat, 4326)::geography, pp.radius)::geometry
          )
        ) > (LEAST(
          ST_Area(gc.circle_geometry),
          ST_Area(ST_Buffer(ST_Point(pp.lng, pp.lat, 4326)::geography, pp.radius)::geometry)
        ) * 0.005)
      )
    ORDER BY pp.lat, pp.lng
  `);

    if (validPositions.length === 0) return 0;

    const optimalBatchSize = Math.min(1000, validPositions.length);
    let inserted = 0;

    for (let i = 0; i < validPositions.length; i += optimalBatchSize) {
      const batch = validPositions.slice(i, i + optimalBatchSize);
      const gridCells = batch.map((pos: any, idx: number) => ({
        cellId: `grid_${startId + inserted + idx}`,
        latitude: pos.lat.toString(),
        longitude: pos.lng.toString(),
        radius,
        circleGeometry: sql`ST_Buffer(ST_Point(${pos.lng}, ${pos.lat}, 4326)::geography, ${radius})::geometry`,
        level: Math.floor((50000 - radius) / 100),
      }));

      await db.insert(gridCellSchema).values(gridCells);
      inserted += batch.length;
    }

    return inserted;
  }

  async getCountryGeometry() {
    const result = await db.execute(sql`
      SELECT ST_AsGeoJSON(geometry) as geojson 
      FROM countries WHERE iso_a3 = ${this.countryCode}
    `);
    return result[0]?.geojson ? JSON.parse(result[0].geojson as string) : null;
  }

  private async getCountryBounds(): Promise<BoundsResult> {
    const result = await db.execute(sql`
      SELECT ST_XMin(geometry) as min_lng, ST_YMin(geometry) as min_lat,
             ST_XMax(geometry) as max_lng, ST_YMax(geometry) as max_lat
      FROM countries WHERE iso_a3 = ${this.countryCode}
    `);
    return result[0] as unknown as BoundsResult;
  }

  async clearGrid(): Promise<void> {
    console.log("Clearing existing grid...");
    await db.delete(gridCellSchema);
    console.log("Grid cleared");
  }
}
