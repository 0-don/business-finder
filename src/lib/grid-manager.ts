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

      // Calculate expected grid points for this radius
      const latPoints = Math.ceil(
        (bounds.max_lat - bounds.min_lat) / latSpacing
      );
      const avgLngPoints = Math.ceil(
        (bounds.max_lng - bounds.min_lng) /
          ((radius * 2.0 * 360.0) /
            (40075000.0 *
              Math.cos(
                (Math.PI / 180) * ((bounds.max_lat + bounds.min_lat) / 2)
              )))
      );
      const expectedPoints = latPoints * avgLngPoints;
      console.log(`  Expected grid points: ~${expectedPoints}`);

      // Check how many existing circles we need to check against
      const existingCircles = await db.execute(
        sql`SELECT COUNT(*) as count FROM grid_cell`
      );
      console.log(
        `  Existing circles to check against: ${existingCircles[0]?.count || 0}`
      );

      const queryStartTime = dayjs();
      const validPositions = await db.execute(sql`
      WITH 
      lat_series AS (
        SELECT generate_series(${bounds.min_lat}::numeric, ${bounds.max_lat}::numeric, ${latSpacing}::numeric) as lat
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
      )
      SELECT gp.lat, gp.lng
      FROM grid_points gp, country_geom cg
      WHERE ST_Contains(cg.geometry, ST_Point(gp.lng, gp.lat, 4326))
        AND ST_Contains(cg.geometry, ST_Buffer(ST_Point(gp.lng, gp.lat, 4326)::geography, ${radius})::geometry)
        AND NOT EXISTS (
          SELECT 1 FROM grid_cell gc
          WHERE ST_Intersects(
            gc.circle_geometry,
            ST_Buffer(ST_Point(gp.lng, gp.lat, 4326)::geography, ${radius})::geometry
          )
        )
      ORDER BY gp.lat, gp.lng
    `);
      const queryTime = dayjs().diff(queryStartTime, "second");
      console.log(
        `  Query took: ${queryTime}s, found ${validPositions.length} valid positions`
      );

      if (validPositions.length > 0) {
        const insertStartTime = dayjs();
        const gridCells = validPositions.map((pos: any, idx: number) => ({
          cellId: `grid_${gridId + idx}`,
          latitude: pos.lat.toString(),
          longitude: pos.lng.toString(),
          radius,
          circleGeometry: sql`ST_Buffer(ST_Point(${pos.lng}, ${pos.lat}, 4326)::geography, ${radius})::geometry`,
          level: Math.floor((initialRadius - radius) / 100),
        }));

        await db.insert(gridCellSchema).values(gridCells);
        const insertTime = dayjs().diff(insertStartTime, "millisecond");
        console.log(`  Insert took: ${insertTime}ms`);

        gridId += validPositions.length;
        totalPlaced += validPositions.length;
      }

      const radiusTime = dayjs().diff(radiusStartTime, "second");
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
