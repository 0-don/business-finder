import { and, count, eq, sql } from "drizzle-orm";
import {
  cellToChildren,
  cellToLatLng,
  getResolution,
  latLngToCell,
} from "h3-js";
import { db, sqlite } from "../db";
import { gridCellSchema } from "../db/schema";

export interface NaturalEarthGridCell {
  h3Index: string;
  resolution: number;
  lat: number;
  lng: number;
  radius: number;
  country: string;
  admin1?: string;
}

export interface GridStats {
  resolution: number;
  total: number;
  processed: number;
  exhausted: number;
}

export interface CellProgress {
  currentPage: number;
  nextPageToken?: string | null;
  totalResults: number;
}

export class NaturalEarthGridManager {
  /**
   * Generate initial 50km grid covering Germany using Natural Earth boundaries
   */
  async initializeGermanyGrid(): Promise<void> {
    console.log(
      "Initializing 50km grid for Germany using Natural Earth data..."
    );

    // Query Germany's boundaries from Natural Earth
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
      .get() as {
      min_lng: number;
      max_lng: number;
      min_lat: number;
      max_lat: number;
    };

    if (!germanyBounds) {
      throw new Error("Germany boundaries not found in Natural Earth database");
    }

    // Get German states for additional context
    const germanStates = sqlite
      .prepare(
        `
      SELECT name, latitude, longitude, iso_a2
      FROM ne_10m_admin_1_states_provinces 
      WHERE iso_a2 = 'DE'
    `
      )
      .all() as Array<{
      name: string;
      latitude: number;
      longitude: number;
      iso_a2: string;
    }>;

    console.log(
      `Found ${germanStates.length} German states in Natural Earth data`
    );

    // Generate grid points at ~50km intervals
    const gridCells: Array<{
      h3Index: string;
      resolution: number;
      latitude: string;
      longitude: string;
    }> = [];

    // 50km ≈ 0.45 degrees latitude, ~0.7 degrees longitude (varies by latitude)
    const latStep = 0.45; // ~50km

    for (
      let lat = germanyBounds.min_lat;
      lat <= germanyBounds.max_lat;
      lat += latStep
    ) {
      // Longitude step varies by latitude
      const lngStep = 0.45 / Math.cos((lat * Math.PI) / 180);

      for (
        let lng = germanyBounds.min_lng;
        lng <= germanyBounds.max_lng;
        lng += lngStep
      ) {
        // Check if point is within Germany using populated places as reference
        if (this.isPointInGermany(lat, lng)) {
          const h3Index = latLngToCell(lat, lng, 6); // Resolution 6 ≈ 36km edge length

          gridCells.push({
            h3Index,
            resolution: 6,
            latitude: lat.toString(),
            longitude: lng.toString(),
          });
        }
      }
    }

    console.log(`Generated ${gridCells.length} initial grid cells`);

    // Insert into database in batches
    for (let i = 0; i < gridCells.length; i += 100) {
      const batch = gridCells.slice(i, i + 100);
      await db.insert(gridCellSchema).values(batch).onConflictDoNothing();
    }

    console.log(`Inserted ${gridCells.length} grid cells into database`);
  }

  /**
   * Get cell progress (current page, next page token, total results)
   */
  async getCellProgress(h3Index: string): Promise<CellProgress | null> {
    const [cell] = await db
      .select({
        currentPage: gridCellSchema.currentPage,
        nextPageToken: gridCellSchema.nextPageToken,
        totalResults: gridCellSchema.totalResults,
      })
      .from(gridCellSchema)
      .where(eq(gridCellSchema.h3Index, h3Index))
      .limit(1);

    if (!cell) return null;

    return {
      currentPage: cell.currentPage ?? 0,
      nextPageToken: cell.nextPageToken,
      totalResults: cell.totalResults ?? 0,
    };
  }

  /**
   * Update cell progress after processing a page
   */
  async updateCellProgress(
    h3Index: string,
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
      .where(eq(gridCellSchema.h3Index, h3Index));
  }

  /**
   * Get grid statistics by resolution
   */
  async getGridStats(): Promise<GridStats[]> {
    const stats = await db
      .select({
        resolution: gridCellSchema.resolution,
        total: count(),
        processed: sql<number>`count(case when ${gridCellSchema.isProcessed} then 1 end)`,
        exhausted: sql<number>`count(case when ${gridCellSchema.isExhausted} then 1 end)`,
      })
      .from(gridCellSchema)
      .groupBy(gridCellSchema.resolution)
      .orderBy(gridCellSchema.resolution);

    return stats;
  }

  /**
   * Get the next unprocessed cell
   */
  async getNextUnprocessedCell(): Promise<NaturalEarthGridCell | null> {
    const [cell] = await db
      .select()
      .from(gridCellSchema)
      .where(
        and(
          eq(gridCellSchema.isProcessed, false),
          eq(gridCellSchema.isExhausted, false)
        )
      )
      .orderBy(gridCellSchema.resolution, gridCellSchema.id)
      .limit(1);

    if (!cell) return null;

    const lat = parseFloat(cell.latitude);
    const lng = parseFloat(cell.longitude);

    // Get nearby populated places for context
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
      h3Index: cell.h3Index,
      resolution: cell.resolution,
      lat,
      lng,
      radius: this.getSearchRadius(cell.resolution),
      country: "Germany",
      admin1: nearbyPlaces?.name,
    };
  }

  /**
   * Check if point is within Germany using populated places
   */
  private isPointInGermany(lat: number, lng: number): boolean {
    // Use populated places within a reasonable distance to determine if point is in Germany
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
      .get(lat - 0.5, lat + 0.5, lng - 0.5, lng + 0.5) as { count: number };

    return nearbyPlaces.count > 0;
  }

  /**
   * Find nearest German state to a point
   */
  private findNearestState(
    lat: number,
    lng: number,
    states: Array<{ name: string; latitude: number; longitude: number }>
  ): { name: string } | null {
    let minDistance = Infinity;
    let nearestState = null;

    for (const state of states) {
      const distance = Math.sqrt(
        Math.pow(lat - state.latitude, 2) + Math.pow(lng - state.longitude, 2)
      );

      if (distance < minDistance) {
        minDistance = distance;
        nearestState = state;
      }
    }

    return nearestState;
  }

  /**
   * Get grid cell details including Natural Earth context
   */
  async getGridCellWithContext(
    h3Index: string
  ): Promise<NaturalEarthGridCell | null> {
    const [cell] = await db
      .select()
      .from(gridCellSchema)
      .where(eq(gridCellSchema.h3Index, h3Index))
      .limit(1);

    if (!cell) return null;

    const lat = parseFloat(cell.latitude);
    const lng = parseFloat(cell.longitude);

    // Get nearby populated places for context
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
      h3Index: cell.h3Index,
      resolution: cell.resolution,
      lat,
      lng,
      radius: this.getSearchRadius(cell.resolution),
      country: "Germany",
      admin1: nearbyPlaces?.name,
    };
  }

  /**
   * Subdivide a grid cell when it hits the 60 result limit (20 results × 3 pages)
   */
  async subdivideCell(parentH3Index: string): Promise<void> {
    const currentResolution = getResolution(parentH3Index);
    const newResolution = Math.min(currentResolution + 1, 8); // Max resolution 8

    if (newResolution > 8) {
      console.log(
        `Cannot subdivide ${parentH3Index} further (max resolution reached)`
      );
      await this.markCellExhausted(parentH3Index);
      return;
    }

    console.log(
      `Subdividing cell ${parentH3Index} from resolution ${currentResolution} to ${newResolution}`
    );

    // Get child cells
    const childCells = cellToChildren(parentH3Index, newResolution);

    // Filter children that are still in Germany
    const validChildren = childCells.filter((childH3) => {
      const [lat, lng] = cellToLatLng(childH3);
      return this.isPointInGermany(lat, lng);
    });

    console.log(`Adding ${validChildren.length} child cells`);

    // Insert child cells
    const childGridCells = validChildren.map((childH3) => {
      const [lat, lng] = cellToLatLng(childH3);
      return {
        h3Index: childH3,
        resolution: newResolution,
        latitude: lat.toString(),
        longitude: lng.toString(),
      };
    });

    // Batch insert
    for (let i = 0; i < childGridCells.length; i += 50) {
      const batch = childGridCells.slice(i, i + 50);
      await db.insert(gridCellSchema).values(batch).onConflictDoNothing();
    }

    // Remove parent cell from database since it's been subdivided
    await db
      .delete(gridCellSchema)
      .where(eq(gridCellSchema.h3Index, parentH3Index));

    console.log(
      `Subdivided ${parentH3Index} into ${validChildren.length} child cells`
    );
  }

  /**
   * Mark cell as exhausted (no more subdivision needed)
   */
  async markCellExhausted(h3Index: string): Promise<void> {
    await db
      .update(gridCellSchema)
      .set({
        isExhausted: true,
        isProcessed: true,
        updatedAt: new Date(),
      })
      .where(eq(gridCellSchema.h3Index, h3Index));
  }

  private getSearchRadius(resolution: number): number {
    const radiusMap: Record<number, number> = {
      4: 50000, // ~50km
      5: 20000, // ~20km
      6: 8000, // ~8km
      7: 3000, // ~3km
      8: 1000, // ~1km
    };
    return radiusMap[resolution] || 50000;
  }

  close(): void {
    sqlite.close();
  }
}
