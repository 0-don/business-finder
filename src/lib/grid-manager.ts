import { count, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { countries, gridCellSchema } from "../db/schema";
import { GridCell, GridStats } from "../types";

export class GridManager {
  private static readonly GRID_SPACING = 50000; // 50km spacing in meters
  private static readonly CIRCLE_RADIUS = 25000; // 25km radius for circles

  async initializeGermanyGrid(): Promise<void> {
    // Verify Germany exists in database
    const germanyExists = await db
      .select({ count: count() })
      .from(countries)
      .where(eq(countries.isoA3, "DEU"));

    if (germanyExists[0]?.count === 0) {
      throw new Error("Germany geometry not found in database");
    }

    // Create grid points within Germany using PostGIS
    const gridPoints = (await db.execute(sql`
      WITH germany AS (
        SELECT geometry FROM countries WHERE iso_a3 = 'DEU'
      ),
      grid AS (
        SELECT 
          ROW_NUMBER() OVER() as grid_id,
          ST_Centroid(geom) as point
        FROM germany,
        LATERAL ST_SquareGrid(${GridManager.GRID_SPACING}, geometry) as geom
      )
      SELECT 
        'grid_' || grid_id as cell_id,
        ST_X(point) as lng,
        ST_Y(point) as lat
      FROM grid
      WHERE ST_Within(point, (SELECT geometry FROM germany))
    `)) as Array<{ cell_id: string; lng: number; lat: number }>;

    const gridCells = gridPoints.map((row) => ({
      cellId: row.cell_id,
      latitude: row.lat.toString(),
      longitude: row.lng.toString(),
      radius: GridManager.CIRCLE_RADIUS,
      level: 0,
    }));

    // Insert in batches of 100
    for (let i = 0; i < gridCells.length; i += 100) {
      const batch = gridCells.slice(i, i + 100);
      await db.insert(gridCellSchema).values(batch).onConflictDoNothing();
    }

    console.log(`Created ${gridCells.length} grid cells within Germany`);
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
    await db.delete(gridCellSchema);
  }
}
