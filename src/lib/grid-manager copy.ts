import dayjs from "dayjs";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { gridCellSchema } from "../db/schema";
import { BoundsResult } from "../types";

export class GridManager {
  countryCode: string;

  constructor(countryCode: string) {
    this.countryCode = countryCode;
  }

  async initializeCountryGrid(initialRadius: number = 50000): Promise<void> {
    console.log(`Initializing grid for ${this.countryCode}...`);
    const startTime = dayjs();

    const bounds = (
      await db.execute(sql`
    SELECT ST_XMin(geometry) as min_lng, ST_YMin(geometry) as min_lat,
           ST_XMax(geometry) as max_lng, ST_YMax(geometry) as max_lat
    FROM countries WHERE iso_a3 = ${this.countryCode}
  `)
    )[0] as unknown as BoundsResult;

    let gridId = 1;
    let totalPlaced = 0;

    for (let radius = initialRadius; radius >= 100; radius -= 100) {
      const radiusStartTime = dayjs();
      console.log(`Processing radius: ${radius}m`);

      const latSpacing = (radius * 2.0 * 360.0) / 40008000.0;

      const existingCount = await db.execute(
        sql`SELECT COUNT(*) as count FROM grid_cell`
      );
      console.log(
        `  Existing circles to check against: ${existingCount[0]?.count || 0}`
      );

      const queryStartTime = dayjs();

      // Process in spatial chunks to reduce overlap checks
      const latChunkSize = latSpacing * 10; // Process 10 latitude rows at a time
      let currentLat = bounds.min_lat;
      let radiusTotal = 0;

      while (currentLat < bounds.max_lat) {
        const chunkEndLat = Math.min(currentLat + latChunkSize, bounds.max_lat);

        const chunkPositions = await db.execute(sql`
        WITH 
        lat_series AS (
          SELECT generate_series(${currentLat}::numeric, ${chunkEndLat}::numeric, ${latSpacing}::numeric) as lat
        ),
        grid_points AS (
          SELECT 
            lat,
            lng_series.lng
          FROM lat_series
          CROSS JOIN LATERAL generate_series(
            ${bounds.min_lng}::numeric,
            ${bounds.max_lng}::numeric,
            calculate_lng_spacing(lat, ${radius * 2})
          ) AS lng_series(lng)
        ),
        country_geom AS (
          SELECT geometry FROM countries WHERE iso_a3 = ${this.countryCode}
        ),
        -- Only check nearby circles within expanded bounds for this chunk
        nearby_circles AS (
          SELECT circle_geometry 
          FROM grid_cell 
          WHERE ST_Intersects(
            circle_geometry,
            ST_MakeEnvelope(${bounds.min_lng - 0.1}, ${currentLat - 0.1}, ${bounds.max_lng + 0.1}, ${chunkEndLat + 0.1}, 4326)
          )
        )
        SELECT gp.lat, gp.lng
        FROM grid_points gp, country_geom cg
        WHERE ST_Contains(cg.geometry, ST_Point(gp.lng, gp.lat, 4326))
          AND ST_Contains(cg.geometry, ST_Buffer(ST_Point(gp.lng, gp.lat, 4326)::geography, ${radius})::geometry)
          AND NOT EXISTS (
            SELECT 1 FROM nearby_circles nc
            WHERE ST_Intersects(
              nc.circle_geometry,
              ST_Buffer(ST_Point(gp.lng, gp.lat, 4326)::geography, ${radius})::geometry
            )
          )
        ORDER BY gp.lat, gp.lng
      `);

        if (chunkPositions.length > 0) {
          const gridCells = chunkPositions.map((pos: any, idx: number) => ({
            cellId: `grid_${gridId + idx}`,
            latitude: pos.lat.toString(),
            longitude: pos.lng.toString(),
            radius,
            circleGeometry: sql`ST_Buffer(ST_Point(${pos.lng}, ${pos.lat}, 4326)::geography, ${radius})::geometry`,
            level: Math.floor((initialRadius - radius) / 100),
          }));

          await db.insert(gridCellSchema).values(gridCells);
          gridId += chunkPositions.length;
          radiusTotal += chunkPositions.length;
          totalPlaced += chunkPositions.length;
        }

        currentLat = chunkEndLat;
      }

      const queryTime = dayjs().diff(queryStartTime, "second");
      const radiusTime = dayjs().diff(radiusStartTime, "second");
      console.log(`  Found ${radiusTotal} valid positions in ${queryTime}s`);
      console.log(`  Total time for radius ${radius}m: ${radiusTime}s\n`);
    }

    const totalTime = dayjs().diff(startTime, "minute");
    console.log(
      `Grid initialization complete: ${totalPlaced} total circles placed in ${totalTime}m`
    );
  }

  async getCountryGeometry() {
    const result = await db.execute(sql`
      SELECT ST_AsGeoJSON(geometry) as geojson 
      FROM countries WHERE iso_a3 = ${this.countryCode}
    `);
    return result[0]?.geojson ? JSON.parse(result[0].geojson as string) : null;
  }

  async clearGrid(): Promise<void> {
    await db.delete(gridCellSchema);
  }
}
