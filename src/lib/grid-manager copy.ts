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

    const bounds = (await db.execute(sql`
      SELECT ST_XMin(geometry) as min_lng, ST_YMin(geometry) as min_lat,
             ST_XMax(geometry) as max_lng, ST_YMax(geometry) as max_lat
      FROM countries WHERE iso_a3 = ${this.countryCode}
    `))[0] as unknown as BoundsResult;

    let gridId = 1;
    let totalPlaced = 0;

    for (let radius = initialRadius; radius >= 100; radius -= 100) {
      console.log(`Processing radius: ${radius}m`);
      // Use diameter * 1.1 to ensure no overlap
      const spacing = (radius * 2.2 * 360.0) / 40008000.0;

      const validPositions = await db.execute(sql`
        WITH 
        lat_series AS (
          SELECT generate_series(${bounds.min_lat}::numeric, ${bounds.max_lat}::numeric, ${spacing}::numeric) as lat
        ),
        lng_series AS (
          SELECT generate_series(${bounds.min_lng}::numeric, ${bounds.max_lng}::numeric, ${spacing}::numeric) as lng  
        ),
        grid_points AS (
          SELECT lat, lng 
          FROM lat_series 
          CROSS JOIN lng_series
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
            WHERE ST_DWithin(
              ST_Point(gc.longitude::numeric, gc.latitude::numeric, 4326)::geography,
              ST_Point(gp.lng, gp.lat, 4326)::geography,
              gc.radius + ${radius} + 50
            )
          )
        ORDER BY gp.lat, gp.lng
        LIMIT 100
      `);

      if (validPositions.length > 0) {
        const gridCells = validPositions.map((pos: any, idx: number) => ({
          cellId: `grid_${gridId + idx}`,
          latitude: pos.lat.toString(),
          longitude: pos.lng.toString(),
          radius,
          level: Math.floor((initialRadius - radius) / 100),
        }));

        await db.insert(gridCellSchema).values(gridCells);
        gridId += validPositions.length;
        totalPlaced += validPositions.length;
        console.log(`  Placed ${validPositions.length} circles`);
      } else {
        console.log(`  No valid positions found for radius ${radius}m`);
      }
    }

    console.log(`Grid initialization complete: ${totalPlaced} total circles placed`);
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