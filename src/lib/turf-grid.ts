import * as turf from "@turf/turf";
import { and, count, eq, sql } from "drizzle-orm";
import { db, sqlite } from "../db";
import { gridCellSchema } from "../db/schema";

export interface GridCell {
  cellId: string;
  lat: number;
  lng: number;
  radius: number;
  level: number;
  country: string;
  admin1?: string;
}

export interface GridStats {
  level: number;
  total: number;
  processed: number;
  exhausted: number;
}

export interface CellProgress {
  currentPage: number;
  nextPageToken?: string | null;
  totalResults: number;
}

export class TurfGridManager {
  private static readonly MAX_LEVEL = 8;
  private static readonly MIN_RADIUS = 500; // 500m minimum
  private static readonly INITIAL_RADIUS = 25000; // 25km initial radius

  /**
   * Initialize grid covering Germany using regular spacing
   */
  async initializeGermanyGrid(): Promise<void> {
    console.log("Initializing grid for Germany using Turf.js...");

    // Get Germany bounds from Natural Earth
    const germanyBounds = sqlite
      .prepare(
        `
      SELECT 
        MIN(label_x) as min_lng,
        MAX(label_x) as max_lng,
        MIN(label_y) as min_lat,
        MAX(label_y) as max_lat
      FROM ne_10m_admin_0_countries 
      WHERE iso_a3 = 'DEU'
    `
      )
      .get() as
      | {
          min_lng: number;
          max_lng: number;
          min_lat: number;
          max_lat: number;
        }
      | undefined;

    if (!germanyBounds) {
      throw new Error("Germany boundaries not found");
    }

    // Create bounding box
    const bbox: [number, number, number, number] = [
      germanyBounds.min_lng,
      germanyBounds.min_lat,
      germanyBounds.max_lng,
      germanyBounds.max_lat,
    ];

    // Generate grid points with 25km spacing
    const spacing = 25; // kilometers
    const points = turf.pointGrid(bbox, spacing, { units: "kilometers" });

    const gridCells: Array<{
      cellId: string;
      latitude: string;
      longitude: string;
      radius: number;
      level: number;
    }> = [];

    let cellIndex = 0;
    for (const point of points.features) {
      const [lng, lat] = point.geometry.coordinates;

      // Check if point is within Germany
      if (this.isPointInGermany(lat!, lng!)) {
        gridCells.push({
          cellId: `cell_${cellIndex++}_level_0`,
          latitude: lat!.toString(),
          longitude: lng!.toString(),
          radius: TurfGridManager.INITIAL_RADIUS,
          level: 0,
        });
      }
    }

    console.log(`Generated ${gridCells.length} initial grid cells`);

    // Insert in batches
    for (let i = 0; i < gridCells.length; i += 100) {
      const batch = gridCells.slice(i, i + 100);
      await db.insert(gridCellSchema).values(batch).onConflictDoNothing();
    }

    console.log(`Inserted ${gridCells.length} grid cells`);
  }

  /**
   * Get cell progress
   */
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

  /**
   * Update cell progress
   */
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

  /**
   * Get grid statistics
   */
  async getGridStats(): Promise<GridStats[]> {
    const stats = await db
      .select({
        level: gridCellSchema.level,
        total: count(),
        processed: sql<number>`count(case when ${gridCellSchema.isProcessed} then 1 end)`,
        exhausted: sql<number>`count(case when ${gridCellSchema.isExhausted} then 1 end)`,
      })
      .from(gridCellSchema)
      .groupBy(gridCellSchema.level)
      .orderBy(gridCellSchema.level);

    return stats;
  }

  /**
   * Get next unprocessed cell
   */
  async getNextUnprocessedCell(): Promise<GridCell | null> {
    const [cell] = await db
      .select()
      .from(gridCellSchema)
      .where(
        and(
          eq(gridCellSchema.isProcessed, false),
          eq(gridCellSchema.isExhausted, false)
        )
      )
      .orderBy(gridCellSchema.level, gridCellSchema.id)
      .limit(1);

    if (!cell) return null;

    const lat = parseFloat(cell.latitude);
    const lng = parseFloat(cell.longitude);

    // Get nearby places for context
    const nearbyPlaces = sqlite
      .prepare(
        `
      SELECT name, featurecla, pop_max
      FROM ne_10m_populated_places 
      WHERE iso_a2 = 'DE'
      AND latitude BETWEEN ? AND ?
      AND longitude BETWEEN ? AND ?
      ORDER BY pop_max DESC
      LIMIT 1
    `
      )
      .get(lat - 0.2, lat + 0.2, lng - 0.2, lng + 0.2) as
      | {
          name: string;
          featurecla: string;
          pop_max: number;
        }
      | undefined;

    return {
      cellId: cell.cellId,
      lat,
      lng,
      radius: cell.radius,
      level: cell.level,
      country: "Germany",
      admin1: nearbyPlaces?.name,
    };
  }

  /**
   * Subdivide a cell by creating 4 smaller cells in a 2x2 grid pattern
   */
  async subdivideCell(parentCellId: string): Promise<void> {
    const [parentCell] = await db
      .select()
      .from(gridCellSchema)
      .where(eq(gridCellSchema.cellId, parentCellId))
      .limit(1);

    if (!parentCell) return;

    const newLevel = parentCell.level + 1;
    const newRadius = Math.max(
      Math.floor(parentCell.radius * 0.6),
      TurfGridManager.MIN_RADIUS
    );

    if (
      newLevel > TurfGridManager.MAX_LEVEL ||
      newRadius < TurfGridManager.MIN_RADIUS
    ) {
      console.log(`Cannot subdivide ${parentCellId} further`);
      await this.markCellExhausted(parentCellId);
      return;
    }

    const centerLat = parseFloat(parentCell.latitude);
    const centerLng = parseFloat(parentCell.longitude);

    // Create 2x2 grid with controlled overlap
    const spacing = (newRadius * 1.4) / 1000; // ~30% overlap, convert to km for turf
    const center = turf.point([centerLng, centerLat]);

    const childCells = [
      turf.destination(center, spacing, 45), // Northeast
      turf.destination(center, spacing, 135), // Southeast
      turf.destination(center, spacing, 225), // Southwest
      turf.destination(center, spacing, 315), // Northwest
    ];

    const validChildren = childCells.filter((child) => {
      const [lng, lat] = child.geometry.coordinates;
      return this.isPointInGermany(lat!, lng!);
    });

    if (validChildren.length === 0) {
      await this.markCellExhausted(parentCellId);
      return;
    }

    const childGridCells = validChildren.map((child, index) => {
      const [lng, lat] = child.geometry.coordinates;
      return {
        cellId: `${parentCellId}_child_${index}`,
        latitude: lat!.toString(),
        longitude: lng!.toString(),
        radius: newRadius,
        level: newLevel,
      };
    });

    // Insert children
    await db
      .insert(gridCellSchema)
      .values(childGridCells)
      .onConflictDoNothing();

    // Remove parent
    await db
      .delete(gridCellSchema)
      .where(eq(gridCellSchema.cellId, parentCellId));

    console.log(
      `Subdivided ${parentCellId} into ${validChildren.length} children with ${newRadius}m radius`
    );
  }

  /**
   * Mark cell as exhausted
   */
  async markCellExhausted(cellId: string): Promise<void> {
    await db
      .update(gridCellSchema)
      .set({
        isExhausted: true,
        isProcessed: true,
        updatedAt: new Date(),
      })
      .where(eq(gridCellSchema.cellId, cellId));
  }

  private isPointInGermany(lat: number, lng: number): boolean {
    const nearbyPlaces = sqlite
      .prepare(
        `
      SELECT COUNT(*) as count
      FROM ne_10m_populated_places 
      WHERE iso_a2 = 'DE' 
      AND latitude BETWEEN ? AND ?
      AND longitude BETWEEN ? AND ?
      LIMIT 1
    `
      )
      .get(lat - 0.5, lat + 0.5, lng - 0.5, lng + 0.5) as
      | { count: number }
      | undefined;

    return (nearbyPlaces?.count ?? 0) > 0;
  }

  close(): void {
    sqlite.close();
  }
}
