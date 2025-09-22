import "@dotenvx/dotenvx/config";
import { getPlacesNearby } from "./client";
import { conflictUpdateAllExcept, db } from "./db";
import { businessSchema } from "./db/schema";
import {
  GRID_MANAGER,
  MAX_PAGES_PER_CELL,
  MAX_RESULTS_PER_CELL,
  RESULTS_PER_PAGE,
} from "./lib/constants";
import { GridCell } from "./types";

async function searchGridCell(gridCell: GridCell): Promise<number> {
  const { cellId, lat, lng, radius, level } = gridCell;

  console.log(
    `Searching ${cellId} (L${level}) - ${lat.toFixed(3)},${lng.toFixed(3)} R:${radius}m`
  );

  const progress = await GRID_MANAGER.getCellProgress(cellId);
  let currentPage = progress?.currentPage || 0;
  let nextPageToken = progress?.nextPageToken;
  let totalResults = progress?.totalResults || 0;

  while (currentPage < MAX_PAGES_PER_CELL) {
    const response = await getPlacesNearby(lat, lng, radius, nextPageToken);
    const pageResults = response.data.results.length;
    totalResults += pageResults;

    if (pageResults > 0) {
      console.log(`  P${currentPage + 1}: ${pageResults} results`);
    }

    // Process results (same as before)
    for (const place of response.data.results) {
      if (place.place_id && place.name && place.geometry?.location) {
        await db
          .insert(businessSchema)
          .values({
            placeId: place.place_id,
            name: place.name,
            address: place.formatted_address || place.vicinity || "",
            vicinity: place.vicinity || null,
            formattedAddress: place.formatted_address || null,
            rating: place.rating?.toString() || null,
            userRatingsTotal: place.user_ratings_total || 0,
            latitude: place.geometry.location.lat.toString(),
            longitude: place.geometry.location.lng.toString(),
            businessStatus: place.business_status || null,
            types: place.types || null,
            openingHours: place.opening_hours || null,
            photos: place.photos || null,
            plusCode: place.plus_code || null,
            icon: place.icon || null,
            iconBackgroundColor: place.icon_background_color || null,
            iconMaskBaseUri: place.icon_mask_base_uri || null,
            priceLevel: place.price_level || null,
            website: null,
            phoneNumber: null,
            internationalPhoneNumber: null,
            utcOffset: null,
          })
          .onConflictDoUpdate({
            target: businessSchema.placeId,
            set: conflictUpdateAllExcept(businessSchema, [
              "id",
              "placeId",
              "createdAt",
            ]),
          });
      }
    }

    nextPageToken = response.data.next_page_token;
    currentPage++;

    await GRID_MANAGER.updateCellProgress(
      cellId,
      currentPage,
      nextPageToken,
      totalResults
    );

    if (!nextPageToken || pageResults < RESULTS_PER_PAGE) break;
  }

  console.log(`  Complete: ${totalResults} total`);
  return totalResults;
}

async function main() {
  console.log("Starting business search...");

  try {
    const stats = await GRID_MANAGER.getGridStats();
    if (stats.length === 0) {
      console.log("Initializing grid...");
      await GRID_MANAGER.initializeGermanyGrid();
    }

    // Compact stats display
    const statsSummary = stats
      .map((s) => `L${s.level}:${s.processed}/${s.total}`)
      .join(" ");
    console.log(`Grid: ${statsSummary}`);

    let processedCount = 0;
    while (true) {
      const nextCell = await GRID_MANAGER.getNextUnprocessedCell();

      if (!nextCell) {
        console.log("All cells processed!");
        break;
      }

      processedCount++;
      const totalResults = await searchGridCell(nextCell);

      if (totalResults >= MAX_RESULTS_PER_CELL) {
        console.log(
          `  Subdividing (${totalResults} >= ${MAX_RESULTS_PER_CELL})`
        );
        await GRID_MANAGER.subdivideCell(nextCell.cellId);
      } else {
        await GRID_MANAGER.markCellExhausted(nextCell.cellId);
      }
    }

    console.log("Search completed!");
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
}
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
