// src/lib/grid-manager.ts
import { count, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { countries, gridCellSchema } from "../db/schema";
import { BoundsResult } from "../types";
import { latSpacing } from "./geometry";

export class GridManager {
  async initializeCountryGrid(
    countryCode: string,
    radius: number = 25000
  ): Promise<void> {
    console.log(`Starting ${countryCode} grid initialization...`);

    // Check if country exists
    const countryExists = await db
      .select({ count: count() })
      .from(countries)
      .where(eq(countries.isoA3, countryCode));

    if (countryExists[0]?.count === 0)
      throw new Error(`Country ${countryCode} geometry not found in database`);

    const bbox = (
      await db.execute(sql`
      SELECT 
        ST_XMin(geometry) as min_lng,
        ST_YMin(geometry) as min_lat,
        ST_XMax(geometry) as max_lng,
        ST_YMax(geometry) as max_lat
      FROM countries 
      WHERE iso_a3 = ${countryCode}
    `)
    )[0] as BoundsResult;

    console.log(`${countryCode} bounding box:`, bbox);

    const gridQuery = sql`
      WITH latitude_series AS (
        SELECT 
          generate_series(
            ${bbox.min_lat}::numeric,
            ${bbox.max_lat}::numeric,
            ${latSpacing(radius)}::numeric
          ) as lat
      ),
      grid_coordinates AS (
        SELECT 
          lng_series.lng as lng,
          ls.lat,
          row_number() OVER() as grid_id
        FROM latitude_series ls
        CROSS JOIN LATERAL generate_series(
          ${bbox.min_lng}::numeric,
          ${bbox.max_lng}::numeric,
          calculate_lng_spacing(ls.lat, ${radius})
        ) AS lng_series(lng)
      ),
      country AS (
        SELECT geometry FROM countries WHERE iso_a3 = ${countryCode}
      )
      SELECT 
        'grid_' || gc.grid_id as cell_id,
        gc.lng,
        gc.lat
      FROM grid_coordinates gc, country c
      WHERE ST_Within(ST_Point(gc.lng, gc.lat, 4326), c.geometry)
      ORDER BY gc.lat, gc.lng
    `;

    const gridPoints = (await db.execute(gridQuery)) as Array<{
      cell_id: string;
      lng: number;
      lat: number;
    }>;

    console.log(
      `Generated ${gridPoints.length} grid points covering ${countryCode}`
    );

    if (gridPoints.length === 0) {
      throw new Error(
        `No grid points generated - check ${countryCode} geometry data`
      );
    }

    const gridCells = await db
      .insert(gridCellSchema)
      .values(
        gridPoints.map((row) => ({
          cellId: row.cell_id,
          latitude: row.lat.toString(),
          longitude: row.lng.toString(),
          radius: radius,
          level: 0,
        }))
      )
      .onConflictDoNothing()
      .returning();

    console.log(`Successfully created ${gridCells.length} grid cells`);
  }

  // Convenience method for Germany
  async initializeGermanyGrid(): Promise<void> {
    return this.initializeCountryGrid("DEU", 25000);
  }

  async clearGrid(): Promise<void> {
    console.log("Clearing existing grid cells...");
    await db.delete(gridCellSchema);
  }
}
