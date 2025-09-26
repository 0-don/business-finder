import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { countries, gridCellSchema } from "../db/schema";
import { BoundsResult } from "../types";

dayjs.extend(relativeTime);

interface Circle {
  lat: number;
  lng: number;
  radius: number;
}

interface Point {
  lat: number;
  lng: number;
}

export class GridManager {
  countryCode: string;
  private placedCircles: Circle[] = [];
  private countryGeometry: any = null;

  constructor(countryCode: string) {
    this.countryCode = countryCode;
  }

  async initializeCountryGrid(
    maxRadius: number = 50000,
    minRadius: number = 100
  ): Promise<void> {
    const startTime = dayjs();
    console.log(
      `Initializing optimal circle packing for ${this.countryCode}...`
    );

    await this.loadCountryGeometry();
    const bounds = await this.getCountryBounds();

    // Check existing circles to resume
    const existingCircles = await this.getExistingCircles();
    this.placedCircles = existingCircles;

    let currentRadius = maxRadius;
    const radiusReduction = 0.85; // Reduce by 15% each iteration

    while (currentRadius >= minRadius) {
      const newCircles = await this.packCirclesAtRadius(bounds, currentRadius);

      if (newCircles.length > 0) {
        await this.saveCircles(newCircles, currentRadius);
        this.placedCircles.push(...newCircles);

        console.log(
          `Radius ${Math.round(currentRadius)}m: ${newCircles.length} circles (total: ${this.placedCircles.length}) - ${startTime.fromNow()}`
        );
      }

      currentRadius *= radiusReduction;
    }

    console.log(
      `Circle packing complete: ${this.placedCircles.length} circles - ${startTime.fromNow()}`
    );
  }

  private async packCirclesAtRadius(
    bounds: BoundsResult,
    radius: number
  ): Promise<Circle[]> {
    const newCircles: Circle[] = [];
    const spacing = radius * 1.8; // Minimum distance between circle centers

    // Generate candidate positions using hexagonal packing pattern
    const candidates = this.generateHexagonalCandidates(bounds, spacing);

    // Process candidates in batches for better performance
    const batchSize = 1000;
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      const validBatch = await this.filterValidPositions(batch, radius);
      newCircles.push(...validBatch);
    }

    return newCircles;
  }

  private generateHexagonalCandidates(
    bounds: BoundsResult,
    spacing: number
  ): Point[] {
    const candidates: Point[] = [];
    const latSpacing = (spacing * 360.0) / 40008000.0; // Convert meters to degrees

    let rowIndex = 0;
    for (let lat = bounds.min_lat; lat <= bounds.max_lat; lat += latSpacing) {
      const lngSpacing = this.calculateLngSpacing(lat, spacing);
      const offset = (rowIndex % 2) * (lngSpacing / 2); // Hexagonal offset

      for (
        let lng = bounds.min_lng + offset;
        lng <= bounds.max_lng;
        lng += lngSpacing
      ) {
        candidates.push({ lat, lng });
      }
      rowIndex++;
    }

    return candidates;
  }

  private async filterValidPositions(
    candidates: Point[],
    radius: number
  ): Promise<Circle[]> {
    if (candidates.length === 0) return [];

    // Build candidate values for SQL
    const candidateValues = candidates
      .map((p) => `(${p.lat}, ${p.lng})`)
      .join(",");

    const tolerance = radius < 1000 ? radius * 0.01 : 0;
    const segments = radius >= 1000 ? 32 : radius >= 500 ? 16 : 8;

    const bufferCall =
      segments < 32
        ? `ST_Buffer(ST_Point(c.lng, c.lat, 4326)::geography, ${radius}, 'quad_segs=${segments}')`
        : `ST_Buffer(ST_Point(c.lng, c.lat, 4326)::geography, ${radius})`;

    const validPositions = (await db.execute(sql`
      WITH 
      candidates(lat, lng) AS (VALUES ${sql.raw(candidateValues)}),
      country_geom AS (
        SELECT ${
          tolerance > 0
            ? sql`ST_Simplify(geometry, ${tolerance})`
            : sql`geometry`
        } as geometry 
        FROM countries 
        WHERE iso_a3 = ${this.countryCode}
      ),
      valid_candidates AS (
        SELECT c.lat, c.lng,
               ${sql.raw(bufferCall)}::geometry as circle_geom
        FROM candidates c, country_geom cg
        WHERE ST_Contains(cg.geometry, ST_Point(c.lng, c.lat, 4326))
          AND ST_Contains(cg.geometry, ${sql.raw(bufferCall)}::geometry)
      )
      SELECT vc.lat, vc.lng
      FROM valid_candidates vc
      WHERE NOT EXISTS (
        SELECT 1 FROM grid_cell gc
        WHERE ST_DWithin(gc.circle_geometry, ST_Point(vc.lng, vc.lat, 4326), ${radius * 2.1})
        AND ST_Intersects(gc.circle_geometry, vc.circle_geom)
      )
    `)) as { lat: number; lng: number }[];

    return validPositions.map((pos) => ({
      lat: pos.lat,
      lng: pos.lng,
      radius,
    }));
  }

  private calculateLngSpacing(lat: number, meterSpacing: number): number {
    const latRad = (lat * Math.PI) / 180;
    return Math.max(
      (meterSpacing * 360.0) / (40075000.0 * Math.cos(latRad)),
      0.001
    );
  }

  private async saveCircles(circles: Circle[], radius: number): Promise<void> {
    if (circles.length === 0) return;

    const segments = radius >= 1000 ? 32 : radius >= 500 ? 16 : 8;
    const bufferCall = segments < 32 ? `'quad_segs=${segments}'` : "";
    const roundedRadius = Math.round(radius); // Fix: Round radius to integer

    const gridCells = circles.map((circle) => ({
      latitude: circle.lat.toString(),
      longitude: circle.lng.toString(),
      radius: roundedRadius, // Use rounded radius
      circleGeometry: bufferCall
        ? sql.raw(
            `ST_Buffer(ST_Point(${circle.lng}, ${circle.lat}, 4326)::geography, ${circle.radius}, ${bufferCall})::geometry`
          )
        : sql.raw(
            `ST_Buffer(ST_Point(${circle.lng}, ${circle.lat}, 4326)::geography, ${circle.radius})::geometry`
          ),
      level: Math.floor((50000 - roundedRadius) / 100),
    }));

    await db.insert(gridCellSchema).values(gridCells);
  }
  private async getExistingCircles(): Promise<Circle[]> {
    const existing = await db
      .select({
        lat: sql<number>`latitude::numeric`,
        lng: sql<number>`longitude::numeric`,
        radius: gridCellSchema.radius,
      })
      .from(gridCellSchema);

    return existing.map((row) => ({
      lat: row.lat,
      lng: row.lng,
      radius: row.radius,
    }));
  }

  private async loadCountryGeometry(): Promise<void> {
    const result = await db
      .select({
        geojson: sql<string>`ST_AsGeoJSON(geometry)`,
      })
      .from(countries)
      .where(eq(countries.isoA3, this.countryCode))
      .limit(1);

    this.countryGeometry = result[0]?.geojson
      ? JSON.parse(result[0].geojson)
      : null;
  }

  async getCountryGeometry() {
    if (!this.countryGeometry) {
      await this.loadCountryGeometry();
    }
    return this.countryGeometry;
  }

  private async getCountryBounds(): Promise<BoundsResult> {
    const result = await db
      .select({
        min_lng: sql<number>`ST_XMin(geometry)`,
        min_lat: sql<number>`ST_YMin(geometry)`,
        max_lng: sql<number>`ST_XMax(geometry)`,
        max_lat: sql<number>`ST_YMax(geometry)`,
      })
      .from(countries)
      .where(eq(countries.isoA3, this.countryCode))
      .limit(1);

    return result[0]!;
  }

  async clearGrid(): Promise<void> {
    console.log("Clearing existing grid...");
    await db.delete(gridCellSchema);
    this.placedCircles = [];
    console.log("Grid cleared");
  }

  async getLastProcessedLevel(): Promise<number | null> {
    const result = await db
      .select({
        maxLevel: sql<number>`MAX(level)`,
      })
      .from(gridCellSchema)
      .limit(1);

    return result[0]?.maxLevel ?? null;
  }
}

// import "@dotenvx/dotenvx/config";
// import { getPlacesNearby } from "./client";
// import { conflictUpdateAllExcept, db } from "./db";
// import { businessSchema } from "./db/schema";
// import {
//   GRID_MANAGER,
//   MAX_PAGES_PER_CELL,
//   MAX_RESULTS_PER_CELL,
//   RESULTS_PER_PAGE,
// } from "./lib/constants";
// import { GridCell } from "./types";

// async function searchGridCell(gridCell: GridCell): Promise<number> {
//   const { cellId, lat, lng, radius, level } = gridCell;

//   console.log(
//     `Searching ${cellId} (L${level}) - ${lat.toFixed(3)},${lng.toFixed(3)} R:${radius}m`
//   );

//   const progress = await GRID_MANAGER.getCellProgress(cellId);
//   let currentPage = progress?.currentPage || 0;
//   let nextPageToken = progress?.nextPageToken;
//   let totalResults = progress?.totalResults || 0;

//   while (currentPage < MAX_PAGES_PER_CELL) {
//     const response = await getPlacesNearby(lat, lng, radius, nextPageToken);
//     const pageResults = response.data.results.length;
//     totalResults += pageResults;

//     if (pageResults > 0) {
//       console.log(`  P${currentPage + 1}: ${pageResults} results`);
//     }

//     // Process results (same as before)
//     for (const place of response.data.results) {
//       if (place.place_id && place.name && place.geometry?.location) {
//         await db
//           .insert(businessSchema)
//           .values({
//             placeId: place.place_id,
//             name: place.name,
//             address: place.formatted_address || place.vicinity || "",
//             vicinity: place.vicinity || null,
//             formattedAddress: place.formatted_address || null,
//             rating: place.rating?.toString() || null,
//             userRatingsTotal: place.user_ratings_total || 0,
//             latitude: place.geometry.location.lat.toString(),
//             longitude: place.geometry.location.lng.toString(),
//             businessStatus: place.business_status || null,
//             types: place.types || null,
//             openingHours: place.opening_hours || null,
//             photos: place.photos || null,
//             plusCode: place.plus_code || null,
//             icon: place.icon || null,
//             iconBackgroundColor: place.icon_background_color || null,
//             iconMaskBaseUri: place.icon_mask_base_uri || null,
//             priceLevel: place.price_level || null,
//             website: null,
//             phoneNumber: null,
//             internationalPhoneNumber: null,
//             utcOffset: null,
//           })
//           .onConflictDoUpdate({
//             target: businessSchema.placeId,
//             set: conflictUpdateAllExcept(businessSchema, [
//               "id",
//               "placeId",
//               "createdAt",
//             ]),
//           });
//       }
//     }

//     nextPageToken = response.data.next_page_token;
//     currentPage++;

//     await GRID_MANAGER.updateCellProgress(
//       cellId,
//       currentPage,
//       nextPageToken,
//       totalResults
//     );

//     if (!nextPageToken || pageResults < RESULTS_PER_PAGE) break;
//   }

//   console.log(`  Complete: ${totalResults} total`);
//   return totalResults;
// }

// async function main() {
//   console.log("Starting business search...");

//   try {
//     const stats = await GRID_MANAGER.getGridStats();
//     if (stats.length === 0) {
//       console.log("Initializing grid...");
//       await GRID_MANAGER.initializeGermanyGrid();
//     }

//     // Compact stats display
//     const statsSummary = stats
//       .map((s) => `L${s.level}:${s.processed}/${s.total}`)
//       .join(" ");
//     console.log(`Grid: ${statsSummary}`);

//     let processedCount = 0;
//     while (true) {
//       const nextCell = await GRID_MANAGER.getNextUnprocessedCell();

//       if (!nextCell) {
//         console.log("All cells processed!");
//         break;
//       }

//       processedCount++;
//       const totalResults = await searchGridCell(nextCell);

//       if (totalResults >= MAX_RESULTS_PER_CELL) {
//         console.log(
//           `  Subdividing (${totalResults} >= ${MAX_RESULTS_PER_CELL})`
//         );
//         await GRID_MANAGER.subdivideCell(nextCell.cellId);
//       } else {
//         await GRID_MANAGER.markCellExhausted(nextCell.cellId);
//       }
//     }

//     console.log("Search completed!");
//   } catch (error) {
//     console.error("Error:", error);
//     throw error;
//   }
// }

// main().catch((error) => {
//   console.error("Fatal error:", error);
//   process.exit(1);
// });
