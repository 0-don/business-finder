import { count, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { countries, gridCellSchema } from "../db/schema";
import { GridCell, GridStats } from "../types";

export class GridManager {
  private static readonly GRID_SPACING = 50000; // 50km spacing in meters
  private static readonly CIRCLE_RADIUS = 25000; // 25km radius for circles

  async initializeGermanyGrid(): Promise<void> {
    console.log("Starting Germany grid initialization...");

    // Check if Germany exists
    const germanyExists = await db
      .select({ count: count() })
      .from(countries)
      .where(eq(countries.isoA3, "DEU"));

    if (germanyExists[0]?.count === 0) {
      throw new Error("Germany geometry not found in database");
    }

    // Get Germany's bounding box
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

    // Calculate grid spacing in degrees
    const latSpacing = 0.45;
    const lngSpacing = 0.7;

    console.log(`Using grid spacing: ${latSpacing}° lat, ${lngSpacing}° lng`);

    // Generate complete grid with proper type casting
    const gridPoints = await db.execute(sql`
      WITH grid_coordinates AS (
        SELECT 
          x as lng,
          y as lat,
          ROW_NUMBER() OVER() as grid_id
        FROM generate_series(
          ${bbox.min_lng}::numeric, 
          ${bbox.max_lng}::numeric, 
          ${lngSpacing}::numeric
        ) as x
        CROSS JOIN generate_series(
          ${bbox.min_lat}::numeric, 
          ${bbox.max_lat}::numeric, 
          ${latSpacing}::numeric
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
    `) as Array<{ cell_id: string; lng: number; lat: number }>;

    console.log(`Generated ${gridPoints.length} grid points covering all of Germany`);
    
    if (gridPoints.length === 0) {
      throw new Error("No grid points generated - check Germany geometry data");
    }

    // Show coverage info
    const lats = gridPoints.map(p => p.lat);
    const lngs = gridPoints.map(p => p.lng);
    console.log(`Coverage: Lat ${Math.min(...lats).toFixed(2)} to ${Math.max(...lats).toFixed(2)}`);
    console.log(`Coverage: Lng ${Math.min(...lngs).toFixed(2)} to ${Math.max(...lngs).toFixed(2)}`);

    // Convert to grid cells format
    const gridCells = gridPoints.map((row) => ({
      cellId: row.cell_id,
      latitude: row.lat.toString(),
      longitude: row.lng.toString(),
      radius: GridManager.CIRCLE_RADIUS,
      level: 0,
    }));

    // Insert in batches
    for (let i = 0; i < gridCells.length; i += 100) {
      const batch = gridCells.slice(i, i + 100);
      await db.insert(gridCellSchema).values(batch).onConflictDoNothing();
    }

    console.log(`Successfully created ${gridCells.length} grid cells`);
  }

  async getGridStats(): Promise<GridStats[]> {
    const stats = await db
      .select({
        level: gridCellSchema.level,
        total: count(),
        processed: sql<number>`count(case when ${gridCellSchema.isProcessed} then 1 end)`,
      })
      .from(gridCellSchema)
      .groupBy(gridCellSchema.level)
      .orderBy(gridCellSchema.level);

    return stats;
  }

  async getAllCells(): Promise<GridCell[]> {
    const cells = await db.select().from(gridCellSchema);

    return cells.map((cell) => ({
      cellId: cell.cellId,
      lat: parseFloat(cell.latitude),
      lng: parseFloat(cell.longitude),
      radius: cell.radius,
      level: cell.level,
    }));
  }

  async clearGrid(): Promise<void> {
    console.log("Clearing existing grid cells...");
    await db.delete(gridCellSchema);
  }
}