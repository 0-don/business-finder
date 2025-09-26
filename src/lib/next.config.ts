import dayjs from "dayjs";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { gridCellSchema } from "../db/schema";
import { BoundsResult } from "../types";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

export class GridManager {
  countryCode: string;

  constructor(countryCode: string) {
    this.countryCode = countryCode;
  }

  async initializeCountryGrid(initialRadius: number = 50000): Promise<void> {
    const startTime = dayjs();
    console.log(`Initializing grid for ${this.countryCode}...`);

    const bounds = await this.getCountryBounds();

    const radii = Array.from(
      { length: (initialRadius - 100) / 100 + 1 },
      (_, i) => initialRadius - i * 100
    );

    let gridId = 1;
    let totalPlaced = 0;

    for (const radius of radii) {
      const placed = await this.processRadiusOptimized(bounds, radius, gridId);
      gridId += placed;
      totalPlaced += placed;

      console.log(
        `Radius ${radius}m: ${placed} circles (total: ${totalPlaced}) - ${startTime.fromNow()}`
      );
    }

    console.log(
      `Grid complete: ${totalPlaced} circles - ${startTime.fromNow()}`
    );
  }

  private async processRadiusOptimized(
    bounds: BoundsResult,
    radius: number,
    startId: number
  ): Promise<number> {
    const overlapFactor = 0.999;
    const latSpacing = (radius * 2.0 * 360.0 * overlapFactor) / 40008000.0;

    const validPositions = await db.execute(sql`
    WITH RECURSIVE
    grid_bounds AS (
      SELECT 
        ${bounds.min_lat}::numeric as min_lat,
        ${bounds.max_lat}::numeric as max_lat,
        ${bounds.min_lng}::numeric as min_lng,
        ${bounds.max_lng}::numeric as max_lng,
        ${latSpacing}::numeric as lat_spacing,
        ${radius}::integer as radius,
        ${overlapFactor}::numeric as overlap_factor
    ),
    lat_points AS (
      SELECT generate_series(min_lat, max_lat, lat_spacing) as lat
      FROM grid_bounds
    ),
    potential_points AS (
      SELECT 
        lp.lat,
        generate_series(
          gb.min_lng,
          gb.max_lng,
          calculate_lng_spacing_overlapped(lp.lat, gb.radius * 2, gb.overlap_factor)
        ) as lng,
        gb.radius
      FROM lat_points lp, grid_bounds gb
    ),
    country_geom AS (
      SELECT geometry FROM countries WHERE iso_a3 = ${this.countryCode}
    )
    SELECT pp.lat, pp.lng
    FROM potential_points pp, country_geom cg
    WHERE ST_Contains(cg.geometry, ST_Point(pp.lng, pp.lat, 4326))
      AND ST_Contains(cg.geometry, 
        ST_Buffer(ST_Point(pp.lng, pp.lat, 4326)::geography, pp.radius)::geometry
      )
      AND NOT EXISTS (
        SELECT 1 FROM grid_cell gc
        WHERE ST_Intersects(
          gc.circle_geometry,
          ST_Buffer(ST_Point(pp.lng, pp.lat, 4326)::geography, pp.radius)::geometry
        )
        AND ST_Area(
          ST_Intersection(
            gc.circle_geometry,
            ST_Buffer(ST_Point(pp.lng, pp.lat, 4326)::geography, pp.radius)::geometry
          )
        ) > (ST_Area(ST_Buffer(ST_Point(pp.lng, pp.lat, 4326)::geography, pp.radius)::geometry) * 0.05)
      )
    ORDER BY pp.lat, pp.lng
    LIMIT 1000
  `);

    if (validPositions.length === 0) return 0;

    const optimalBatchSize = Math.min(1000, validPositions.length);
    let inserted = 0;

    for (let i = 0; i < validPositions.length; i += optimalBatchSize) {
      const batch = validPositions.slice(i, i + optimalBatchSize);
      const gridCells = batch.map((pos: any, idx: number) => ({
        cellId: `grid_${startId + inserted + idx}`,
        latitude: pos.lat.toString(),
        longitude: pos.lng.toString(),
        radius,
        circleGeometry: sql`ST_Buffer(ST_Point(${pos.lng}, ${pos.lat}, 4326)::geography, ${radius})::geometry`,
        level: Math.floor((50000 - radius) / 100),
      }));

      await db.insert(gridCellSchema).values(gridCells);
      inserted += batch.length;
    }

    return inserted;
  }

  async getCountryGeometry() {
    const result = await db.execute(sql`
      SELECT ST_AsGeoJSON(geometry) as geojson 
      FROM countries WHERE iso_a3 = ${this.countryCode}
    `);
    return result[0]?.geojson ? JSON.parse(result[0].geojson as string) : null;
  }

  private async getCountryBounds(): Promise<BoundsResult> {
    const result = await db.execute(sql`
      SELECT ST_XMin(geometry) as min_lng, ST_YMin(geometry) as min_lat,
             ST_XMax(geometry) as max_lng, ST_YMax(geometry) as max_lat
      FROM countries WHERE iso_a3 = ${this.countryCode}
    `);
    return result[0] as unknown as BoundsResult;
  }

  async clearGrid(): Promise<void> {
    console.log("Clearing existing grid...");
    await db.delete(gridCellSchema);
    console.log("Grid cleared");
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
