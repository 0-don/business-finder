import * as turf from "@turf/turf";
import { and, count, eq, sql } from "drizzle-orm";
import { db, naturalEarthDb } from "../db";
import {
  ne10MAdmin0Countries,
  ne10MPopulatedPlaces,
} from "../db/natural-earth-schema/schema";
import { gridCellSchema } from "../db/schema";

export interface GridCell {
  cellId: string;
  lat: number;
  lng: number;
  radius: number;
  level: number;
}

export interface GridStats {
  level: number;
  total: number;
  processed: number;
}

export interface CellProgress {
  currentPage: number;
  nextPageToken?: string | null;
  totalResults: number;
}

export class TurfGridManager {
  private static readonly MAX_LEVEL = 8;
  private static readonly MIN_RADIUS = 100; // 100m minimum
  private static readonly INITIAL_RADIUS = 50000; // 50km initial radius

  /**
   * Initialize grid covering Germany using regular spacing
   */
  async initializeGermanyGrid(): Promise<void> {
    // Get Germany bounds from Natural Earth using Drizzle
    const germanyBounds = await naturalEarthDb
      .select({
        minLng: sql<number>`MIN(${ne10MAdmin0Countries.labelX})`,
        maxLng: sql<number>`MAX(${ne10MAdmin0Countries.labelX})`,
        minLat: sql<number>`MIN(${ne10MAdmin0Countries.labelY})`,
        maxLat: sql<number>`MAX(${ne10MAdmin0Countries.labelY})`,
      })
      .from(ne10MAdmin0Countries)
      .where(eq(ne10MAdmin0Countries.isoA3, "DEU"));

    if (!germanyBounds[0]) {
      throw new Error("Germany boundaries not found");
    }

    const bounds = germanyBounds[0];

    // Create bounding box
    const bbox: [number, number, number, number] = [
      bounds.minLng,
      bounds.minLat,
      bounds.maxLng,
      bounds.maxLat,
    ];

    // Generate grid points with 50km spacing for initial coverage
    const spacing = 50; // kilometers
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
      if (await this.isPointInGermany(lat!, lng!)) {
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
      .where(eq(gridCellSchema.isProcessed, false))
      .orderBy(gridCellSchema.level, gridCellSchema.id)
      .limit(1);

    if (!cell) return null;

    const lat = parseFloat(cell.latitude);
    const lng = parseFloat(cell.longitude);

    // Get nearby places for context using Drizzle
    const nearbyPlaces = await naturalEarthDb
      .select({
        name: ne10MPopulatedPlaces.name,
        featurecla: ne10MPopulatedPlaces.featurecla,
        popMax: ne10MPopulatedPlaces.popMax,
      })
      .from(ne10MPopulatedPlaces)
      .where(
        and(
          eq(ne10MPopulatedPlaces.isoA2, "DE"),
          sql`${ne10MPopulatedPlaces.latitude} BETWEEN ${lat - 0.2} AND ${
            lat + 0.2
          }`,
          sql`${ne10MPopulatedPlaces.longitude} BETWEEN ${lng - 0.2} AND ${
            lng + 0.2
          }`
        )
      )
      .orderBy(sql`${ne10MPopulatedPlaces.popMax} DESC`)
      .limit(1);

    return {
      cellId: cell.cellId,
      lat,
      lng,
      radius: cell.radius,
      level: cell.level,
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
      Math.floor(parentCell.radius * 0.65),
      TurfGridManager.MIN_RADIUS
    );

    if (
      newLevel > TurfGridManager.MAX_LEVEL ||
      newRadius < TurfGridManager.MIN_RADIUS
    ) {
      console.log(`Cannot subdivide ${parentCellId} further - removing cell`);
      await this.removeExhaustedCell(parentCellId);
      return;
    }

    const centerLat = parseFloat(parentCell.latitude);
    const centerLng = parseFloat(parentCell.longitude);

    // Create 4 circles with optimal spacing to minimize gaps
    const spacing = (newRadius * 0.9) / 1000; // 90% of radius for better coverage
    const center = turf.point([centerLng, centerLat]);

    const childCells = [
      turf.destination(center, spacing, 45), // Northeast
      turf.destination(center, spacing, 135), // Southeast
      turf.destination(center, spacing, 225), // Southwest
      turf.destination(center, spacing, 315), // Northwest
    ];

    const validChildren = [];
    for (const child of childCells) {
      const [lng, lat] = child.geometry.coordinates;
      if (await this.isPointInGermany(lat!, lng!)) {
        validChildren.push(child);
      }
    }

    if (validChildren.length === 0) {
      await this.removeExhaustedCell(parentCellId);
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
   * Remove exhausted cell completely from the database
   */
  async removeExhaustedCell(cellId: string): Promise<void> {
    await db.delete(gridCellSchema).where(eq(gridCellSchema.cellId, cellId));

    console.log(`Removed exhausted cell: ${cellId}`);
  }

  private async isPointInGermany(lat: number, lng: number): Promise<boolean> {
    const nearbyPlaces = await naturalEarthDb
      .select({
        count: sql<number>`COUNT(*)`,
      })
      .from(ne10MPopulatedPlaces)
      .where(
        and(
          eq(ne10MPopulatedPlaces.isoA2, "DE"),
          sql`${ne10MPopulatedPlaces.latitude} BETWEEN ${lat - 0.5} AND ${
            lat + 0.5
          }`,
          sql`${ne10MPopulatedPlaces.longitude} BETWEEN ${lng - 0.5} AND ${
            lng + 0.5
          }`
        )
      )
      .limit(1);

    return (nearbyPlaces[0]?.count ?? 0) > 0;
  }

  async markCellExhausted(cellId: string): Promise<void> {
    await db
      .update(gridCellSchema)
      .set({ isProcessed: true, updatedAt: new Date() })
      .where(eq(gridCellSchema.cellId, cellId));
  }
}
