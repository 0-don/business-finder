import "@dotenvx/dotenvx/config";
import { Language, PlaceType1 } from "@googlemaps/google-maps-services-js";
import { conflictUpdateAllExcept, db } from "./db";
import { businessSchema, searchLogSchema } from "./db/schema";
import {
  CLIENT,
  GRID_MANAGER,
  MAX_PAGES_PER_CELL,
  MAX_RESULTS_PER_CELL,
  RESULTS_PER_PAGE,
} from "./lib/constants";
import type { GridCell } from "./lib/turf-grid";
import { exponentialBackoff } from "./lib/utils";

async function searchGridCell(gridCell: GridCell): Promise<number> {
  const { cellId, lat, lng, radius, level, admin1 } = gridCell;

  console.log(`\nSearching cell: ${cellId} (level: ${level})`);
  console.log(`  Location: (${lat.toFixed(6)}, ${lng.toFixed(6)})`);
  console.log(`  Radius: ${radius}m`);
  if (admin1) {
    console.log(`  Region: ${admin1}`);
  }

  const progress = await GRID_MANAGER.getCellProgress(cellId);
  let currentPage = progress?.currentPage || 0;
  let nextPageToken = progress?.nextPageToken;
  let totalResults = progress?.totalResults || 0;

  while (currentPage < MAX_PAGES_PER_CELL) {
    console.log(`  Page ${currentPage + 1}/${MAX_PAGES_PER_CELL}`);

    const response = await exponentialBackoff(async () => {
      return CLIENT.placesNearby({
        params: {
          location: { lat, lng },
          radius,
          type: PlaceType1.accounting,
          keyword:
            "tax|steuer|steuerberater|steuerkanzlei|steuerberatung|buchführung|lohnsteuer|wirtschaftsprüfer|finanzbuchhaltung|jahresabschluss|steuererklärung",
          language: Language.de,
          key: process.env.GOOGLE_MAPS_API_KEY!,
          ...(nextPageToken && { pagetoken: nextPageToken }),
        },
      });
    });

    const pageResults = response.data.results.length;
    totalResults += pageResults;
    console.log(`    Found ${pageResults} results`);

    // Process results
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

    // Log search
    await db.insert(searchLogSchema).values({
      cellId,
      latitude: lat.toString(),
      longitude: lng.toString(),
      radius,
      resultsFound: pageResults,
      pageNumber: currentPage + 1,
    });

    nextPageToken = response.data.next_page_token;
    currentPage++;

    await GRID_MANAGER.updateCellProgress(
      cellId,
      currentPage,
      nextPageToken,
      totalResults
    );

    if (!nextPageToken || pageResults < RESULTS_PER_PAGE) {
      console.log(`    No more results available`);
      break;
    }
  }

  console.log(`  ✓ Cell completed: ${totalResults} total results`);
  return totalResults;
}

async function main() {
  console.log("Starting Turf.js-based business search...");

  try {
    const stats = await GRID_MANAGER.getGridStats();
    if (stats.length === 0) {
      console.log("Initializing grid...");
      await GRID_MANAGER.initializeGermanyGrid();
    }

    // Show stats
    console.log("\nGrid Statistics:");
    for (const stat of stats) {
      console.log(
        `  Level ${stat.level}: ${stat.processed}/${stat.total} processed (${stat.exhausted} exhausted)`
      );
    }

    let processedCount = 0;
    while (true) {
      const nextCell = await GRID_MANAGER.getNextUnprocessedCell();

      if (!nextCell) {
        console.log("\n🎉 All cells processed!");
        break;
      }

      processedCount++;
      console.log(`\n--- Processing cell ${processedCount} ---`);

      const totalResults = await searchGridCell(nextCell);

      if (totalResults >= MAX_RESULTS_PER_CELL) {
        console.log(`  🔄 Subdividing cell ${nextCell.cellId}...`);
        await GRID_MANAGER.subdivideCell(nextCell.cellId);
      } else {
        console.log(`  ✅ Cell ${nextCell.cellId} exhausted`);
        await GRID_MANAGER.markCellExhausted(nextCell.cellId);
      }
    }

    console.log("\n✅ Search completed!");
  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    GRID_MANAGER.close();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
