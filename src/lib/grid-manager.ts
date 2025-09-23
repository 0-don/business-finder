// src/lib/grid-manager.ts
import { count, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { countries, gridCellSchema } from "../db/schema";

export class GridManager {
  async initializeGermanyGrid(): Promise<void> {
    console.log("Starting Germany grid initialization...");

    // Check if Germany exists
    const germanyExists = await db
      .select({ count: count() })
      .from(countries)
      .where(eq(countries.isoA3, "DEU"));

    if (germanyExists[0]?.count === 0)
      throw new Error("Germany geometry not found in database");

    // Get Germany's bounding box first
    const boundingBox = await db.execute(sql`
      SELECT 
        ST_XMin(geometry) as min_lng,
        ST_YMin(geometry) as min_lat,
        ST_XMax(geometry) as max_lng,
        ST_YMax(geometry) as max_lat
      FROM countries 
      WHERE iso_a3 = 'DEU'
    `);

    const bbox = boundingBox[0] as {
      min_lng: number;
      min_lat: number;
      max_lng: number;
      max_lat: number;
    };

    console.log("Germany bounding box:", bbox);

    // Use sql template literal with proper parameter passing
    const gridPoints = (await db.execute(sql`
      WITH grid_coordinates AS (
        SELECT 
          x as lng,
          y as lat,
          ROW_NUMBER() OVER() as grid_id
        FROM generate_series(
          ${bbox.min_lng}::numeric, 
          ${bbox.max_lng}::numeric, 
          0.7::numeric
        ) as x
        CROSS JOIN generate_series(
          ${bbox.min_lat}::numeric, 
          ${bbox.max_lat}::numeric, 
          0.45::numeric
        ) as y
      ),
      germany AS (
        SELECT geometry FROM countries WHERE iso_a3 = 'DEU'
      )
      SELECT 
        'grid_' || gc.grid_id as cell_id,
        gc.lng,
        gc.lat
      FROM grid_coordinates gc, germany g
      WHERE ST_Within(ST_Point(gc.lng, gc.lat, 4326), g.geometry)
      ORDER BY gc.lat, gc.lng
    `)) as Array<{ cell_id: string; lng: number; lat: number }>;

    console.log(`Generated ${gridPoints.length} grid points covering Germany`);

    if (gridPoints.length === 0) {
      throw new Error("No grid points generated - check Germany geometry data");
    }

    // Insert grid cells in batches
    const gridCells = gridPoints.map((row) => ({
      cellId: row.cell_id,
      latitude: row.lat.toString(),
      longitude: row.lng.toString(),
      radius: 25000,
      level: 0,
    }));

    for (let i = 0; i < gridCells.length; i += 100) {
      const batch = gridCells.slice(i, i + 100);
      await db.insert(gridCellSchema).values(batch).onConflictDoNothing();
    }

    console.log(`Successfully created ${gridCells.length} grid cells`);
  }

  async clearGrid(): Promise<void> {
    console.log("Clearing existing grid cells...");
    await db.execute(sql`DELETE FROM grid_cell`);
  }
}
