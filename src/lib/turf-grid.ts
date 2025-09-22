import * as turf from "@turf/turf";
import { count, eq, sql } from "drizzle-orm";
import { db, naturalEarthDb } from "../db";
import { ne10MAdmin0Countries } from "../db/natural-earth-schema/schema";
import { gridCellSchema } from "../db/schema";
import {
  BoundsResult,
  CellProgress,
  ContainsResult,
  GridCell,
  GridStats,
} from "../types";

export class TurfGridManager {
  private static readonly MAX_LEVEL = 8;
  private static readonly MIN_RADIUS = 100;
  private static readonly INITIAL_RADIUS = 50000;
  private germanyBounds: [number, number, number, number] | null = null;

  private async loadGermanyBounds(): Promise<[number, number, number, number]> {
    if (this.germanyBounds) {
      return this.germanyBounds;
    }

    try {
      const result = (await naturalEarthDb.all(
        sql`SELECT ST_XMin(geometry) as minLng, ST_YMin(geometry) as minLat, 
            ST_XMax(geometry) as maxLng, ST_YMax(geometry) as maxLat 
            FROM ${ne10MAdmin0Countries} WHERE ${ne10MAdmin0Countries.isoA3} = 'DEU'`
      )) as BoundsResult[];

      if (result[0]) {
        this.germanyBounds = [
          result[0].minLng,
          result[0].minLat,
          result[0].maxLng,
          result[0].maxLat,
        ];
        return this.germanyBounds;
      }
    } catch (error) {
      console.log("Spatial functions not available, using static bounds");
    }

    this.germanyBounds = [5.8663, 47.2701, 15.0419, 55.0581];
    return this.germanyBounds;
  }

  async initializeGermanyGrid(): Promise<void> {
    const bbox = await this.loadGermanyBounds();

    const spacing = 50;
    const points = turf.pointGrid(bbox, spacing, { units: "kilometers" });

    const gridCells = [];
    let cellIndex = 0;

    for (const point of points.features) {
      const [lng, lat] = point.geometry.coordinates;

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

    for (let i = 0; i < gridCells.length; i += 100) {
      const batch = gridCells.slice(i, i + 100);
      await db.insert(gridCellSchema).values(batch).onConflictDoNothing();
    }

    console.log(`Inserted ${gridCells.length} grid cells`);
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
      TurfGridManager.MIN_RADIUS
    );

    if (
      newLevel > TurfGridManager.MAX_LEVEL ||
      newRadius < TurfGridManager.MIN_RADIUS
    ) {
      await this.removeExhaustedCell(parentCellId);
      return;
    }

    const centerLat = parseFloat(parentCell.latitude);
    const centerLng = parseFloat(parentCell.longitude);
    const spacing = (newRadius * 0.9) / 1000;
    const center = turf.point([centerLng, centerLat]);

    const childCells = [
      turf.destination(center, spacing, 45),
      turf.destination(center, spacing, 135),
      turf.destination(center, spacing, 225),
      turf.destination(center, spacing, 315),
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

    await db
      .insert(gridCellSchema)
      .values(childGridCells)
      .onConflictDoNothing();
    await db
      .delete(gridCellSchema)
      .where(eq(gridCellSchema.cellId, parentCellId));
  }

  async removeExhaustedCell(cellId: string): Promise<void> {
    await db.delete(gridCellSchema).where(eq(gridCellSchema.cellId, cellId));
  }

  private async isPointInGermany(lat: number, lng: number): Promise<boolean> {
    try {
      const result = (await naturalEarthDb.all(
        sql`SELECT ST_Contains(geometry, ST_Point(${lng}, ${lat})) as contains 
            FROM ${ne10MAdmin0Countries} WHERE ${ne10MAdmin0Countries.isoA3} = 'DEU'`
      )) as ContainsResult[];
      return result[0]?.contains === 1;
    } catch (error) {
      const bounds = await this.loadGermanyBounds();
      return (
        lat >= bounds[1] &&
        lat <= bounds[3] &&
        lng >= bounds[0] &&
        lng <= bounds[2]
      );
    }
  }

  async markCellExhausted(cellId: string): Promise<void> {
    await db
      .update(gridCellSchema)
      .set({ isProcessed: true, updatedAt: new Date() })
      .where(eq(gridCellSchema.cellId, cellId));
  }
}
