import { sql } from "drizzle-orm";
import { db } from "../db";
import { gridCellSchema } from "../db/schema";
import { BoundsResult, GridPoints } from "../types";
import { latSpacing } from "./geometry";

export class GridManager {
  countryCode: string;

  constructor(countryCode: string) {
    this.countryCode = countryCode;
  }

  async initializeCountryGrid(radius: number = 25000): Promise<void> {
    console.log(`Starting ${this.countryCode} grid initialization...`);

    // First check if country exists
    const countryCheck = await db.execute(sql`
      SELECT name, iso_a3 FROM countries WHERE iso_a3 = ${this.countryCode}
    `);

    if (countryCheck.length === 0) {
      console.error(`Country with code ${this.countryCode} not found`);
      return;
    }

    console.log(`Found country: ${countryCheck[0].name}`);

    const bbox = (
      await db.execute(sql`
      SELECT 
        ST_XMin(geometry) as min_lng,
        ST_YMin(geometry) as min_lat,
        ST_XMax(geometry) as max_lng,
        ST_YMax(geometry) as max_lat
      FROM countries 
      WHERE iso_a3 = ${this.countryCode}
    `)
    )[0] as unknown as BoundsResult;

    console.log(`${this.countryCode} bounding box:`, bbox);

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
        SELECT geometry FROM countries WHERE iso_a3 = ${this.countryCode}
      )
      SELECT 
        'grid_' || gc.grid_id as cell_id,
        gc.lng,
        gc.lat
      FROM grid_coordinates gc, country c
      WHERE ST_Intersects(ST_Point(gc.lng, gc.lat, 4326), c.geometry)
      ORDER BY gc.lat, gc.lng
    `;

    const gridPoints = (await db.execute(gridQuery)) as unknown as GridPoints[];

    console.log(
      `Generated ${gridPoints.length} grid points covering ${this.countryCode}`
    );

    // Check if we have grid points before inserting
    if (gridPoints.length === 0) {
      console.error(`No grid points generated for ${this.countryCode}. Check geometry data.`);
      return;
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

  async getCountryGeometry() {
    const result = await db.execute(sql`
      SELECT ST_AsGeoJSON(geometry) as geojson 
      FROM countries 
      WHERE iso_a3 = ${this.countryCode}
    `);

    return result[0]?.geojson ? JSON.parse(result[0].geojson as string) : null;
  }

  async clearGrid(): Promise<void> {
    console.log("Clearing existing grid cells...");
    await db.delete(gridCellSchema);
  }
}