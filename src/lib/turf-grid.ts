import { count, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { countries, gridCellSchema } from "../db/schema";
import { CellProgress, GridCell, GridStats } from "../types";

export class GridManager {
  private static readonly MAX_LEVEL = 8;
  private static readonly MIN_RADIUS = 100;
  private static readonly INITIAL_RADIUS = 50000;

  async initializeGermanyGrid(): Promise<void> {
    // Get Germany's geometry and bounds using PostGIS
    const germanyData = await db
      .select({
        geometry: countries.geometry,
        bounds: sql<string>`ST_Extent(geometry)`.as("bounds"),
      })
      .from(countries)
      .where(eq(countries.isoA3, "DEU"))
      .limit(1);

    if (!germanyData[0]) {
      throw new Error("Germany geometry not found in database");
    }

    // Create a regular grid using PostGIS ST_SquareGrid
    const spacing = 50000; // 50km spacing
    const gridPoints = await db.execute(sql`
      WITH germany AS (
        SELECT geometry FROM countries WHERE iso_a3 = 'DEU'
      ),
      grid AS (
        SELECT 
          ROW_NUMBER() OVER() as grid_id,
          ST_Centroid(geom) as point
        FROM germany,
        LATERAL ST_SquareGrid(${spacing}, geometry) as geom
      )
      SELECT 
        grid_id,
        ST_X(point) as lng,
        ST_Y(point) as lat
      FROM grid
      WHERE ST_Within(point, (SELECT geometry FROM germany))
    `) as Array<{grid_id: number; lng: number; lat: number}>;

    const gridCells = gridPoints.map((row: {grid_id: number; lng: number; lat: number}, index: number) => ({
      cellId: `cell_${index}_level_0`,
      latitude: row.lat.toString(),
      longitude: row.lng.toString(),
      radius: GridManager.INITIAL_RADIUS,
      level: 0,
    }));

    // Insert in batches
    for (let i = 0; i < gridCells.length; i += 100) {
      const batch = gridCells.slice(i, i + 100);
      await db.insert(gridCellSchema).values(batch).onConflictDoNothing();
    }

    console.log(`Inserted ${gridCells.length} grid cells using PostGIS`);
  }

  async getCellProgress(cellId: string): Promise<CellProgress | null> {
    const [cell] = await db
      .select({
        currentPage: gridCellSchema.currentPage,
        nextPageToken: gridCellSchema.nextPageToken,
        totalResults: gridCellSchema.totalResults,
      })
      .from(gridCellSchema)
      .where(eq(gridCellSchema.cellId, cellId))
      .limit(1);

    if (!cell) return null;

    return {
      currentPage: cell.currentPage ?? 0,
      nextPageToken: cell.nextPageToken,
      totalResults: cell.totalResults ?? 0,
    };
  }

  async updateCellProgress(
    cellId: string,
    currentPage: number,
    nextPageToken?: string | null,
    totalResults?: number
  ): Promise<void> {
    await db
      .update(gridCellSchema)
      .set({
        currentPage,
        nextPageToken: nextPageToken || null,
        totalResults: totalResults || 0,
        isProcessed: true,
        updatedAt: new Date(),
      })
      .where(eq(gridCellSchema.cellId, cellId));
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

  async getNextUnprocessedCell(): Promise<GridCell | null> {
    const [cell] = await db
      .select()
      .from(gridCellSchema)
      .where(eq(gridCellSchema.isProcessed, false))
      .orderBy(gridCellSchema.level, gridCellSchema.id)
      .limit(1);

    if (!cell) return null;

    const lat = parseFloat(cell.latitude);
    const lng = parseFloat(cell.longitude);

    return {
      cellId: cell.cellId,
      lat,
      lng,
      radius: cell.radius,
      level: cell.level,
    };
  }

  async subdivideCell(parentCellId: string): Promise<void> {
    const [parentCell] = await db
      .select()
      .from(gridCellSchema)
      .where(eq(gridCellSchema.cellId, parentCellId))
      .limit(1);

    if (!parentCell) return;

    const newLevel = parentCell.level + 1;
    const newRadius = Math.max(
      Math.floor(parentCell.radius * 0.65),
      GridManager.MIN_RADIUS
    );

    if (
      newLevel > GridManager.MAX_LEVEL ||
      newRadius < GridManager.MIN_RADIUS
    ) {
      await this.removeExhaustedCell(parentCellId);
      return;
    }

    const centerLat = parseFloat(parentCell.latitude);
    const centerLng = parseFloat(parentCell.longitude);

    // Use PostGIS to generate child points in a more precise pattern
    const spacing = newRadius * 0.9; // spacing in meters

    const childPoints = await db.execute(sql`
      WITH center AS (
        SELECT ST_SetSRID(ST_Point(${centerLng}, ${centerLat}), 4326) as geom
      ),
      offsets AS (
        SELECT * FROM (VALUES 
          (${spacing}, 45),    -- NE
          (${spacing}, 135),   -- SE  
          (${spacing}, 225),   -- SW
          (${spacing}, 315)    -- NW
        ) AS t(distance, bearing)
      ),
      child_points AS (
        SELECT 
          ROW_NUMBER() OVER() as child_index,
          ST_Project(center.geom::geography, offsets.distance, radians(offsets.bearing))::geometry as point
        FROM center, offsets
      )
      SELECT 
        child_index,
        ST_X(point) as lng,
        ST_Y(point) as lat,
        ST_Within(point, (SELECT geometry FROM countries WHERE iso_a3 = 'DEU')) as in_germany
      FROM child_points
    `) as Array<{child_index: number; lng: number; lat: number; in_germany: boolean}>;

    const validChildren = childPoints
      .filter((row: {child_index: number; lng: number; lat: number; in_germany: boolean}) => row.in_germany === true)
      .map((row: {child_index: number; lng: number; lat: number; in_germany: boolean}) => ({
        cellId: `${parentCellId}_child_${row.child_index}`,
        latitude: row.lat.toString(),
        longitude: row.lng.toString(),
        radius: newRadius,
        level: newLevel,
      }));

    if (validChildren.length === 0) {
      await this.removeExhaustedCell(parentCellId);
      return;
    }

    await db.insert(gridCellSchema).values(validChildren).onConflictDoNothing();
    await db
      .delete(gridCellSchema)
      .where(eq(gridCellSchema.cellId, parentCellId));
  }

  async removeExhaustedCell(cellId: string): Promise<void> {
    await db.delete(gridCellSchema).where(eq(gridCellSchema.cellId, cellId));
  }

  async markCellExhausted(cellId: string): Promise<void> {
    await db
      .update(gridCellSchema)
      .set({ isProcessed: true, updatedAt: new Date() })
      .where(eq(gridCellSchema.cellId, cellId));
  }

  // Utility method to check if a point is within Germany using PostGIS
  async isPointInGermany(lat: number, lng: number): Promise<boolean> {
    const result = await db.execute(sql`
      SELECT ST_Within(
        ST_SetSRID(ST_Point(${lng}, ${lat}), 4326),
        (SELECT geometry FROM countries WHERE iso_a3 = 'DEU')
      ) as within_germany
    `) as Array<{within_germany: boolean}>;

    return result[0]?.within_germany === true;
  }

  // Get grid coverage statistics
  async getGridCoverage(): Promise<{
    totalArea: number;
    gridArea: number;
    coverage: number;
  }> {
    const result = await db.execute(sql`
      WITH germany AS (
        SELECT ST_Area(geometry::geography) / 1000000 as area_km2 
        FROM countries WHERE iso_a3 = 'DEU'
      ),
      grid_coverage AS (
        SELECT COUNT(*) * (PI() * POWER(${GridManager.INITIAL_RADIUS} / 1000.0, 2)) as grid_area_km2
        FROM grid_cell WHERE level = 0
      )
      SELECT 
        germany.area_km2 as total_area,
        grid_coverage.grid_area_km2 as grid_area,
        (grid_coverage.grid_area_km2 / germany.area_km2 * 100) as coverage_percent
      FROM germany, grid_coverage
    `) as Array<{total_area: number; grid_area: number; coverage_percent: number}>;

    const row = result[0];
    return {
      totalArea: row?.total_area || 0,
      gridArea: row?.grid_area || 0,
      coverage: row?.coverage_percent || 0,
    };
  }
}