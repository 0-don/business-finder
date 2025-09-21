import "@dotenvx/dotenvx/config";
import { Language, PlaceType1 } from "@googlemaps/google-maps-services-js";
import { latLngToCell } from "h3-js";
import { getPlaceDetails } from "./client";
import { conflictUpdateAllExcept, db } from "./db";
import { businessSchema, searchLogSchema } from "./db/schema";
import { CLIENT, GRID_MANAGER } from "./lib/constants";
import { type NaturalEarthGridCell } from "./lib/natural-earth-grid";
import { exponentialBackoff } from "./lib/utils";

const MAX_PAGES_PER_CELL = 3;
const RESULTS_PER_PAGE = 20;
const MAX_RESULTS_PER_CELL = 60; // 20 results × 3 pages - subdivision threshold

async function searchGridCell(gridCell: NaturalEarthGridCell): Promise<number> {
  const { h3Index, lat, lng, radius, resolution, admin1 } = gridCell;

  console.log(`\nSearching H3 cell: ${h3Index} (res: ${resolution})`);
  console.log(`  Location: (${lat.toFixed(6)}, ${lng.toFixed(6)})`);
  console.log(`  Radius: ${radius / 1000}km`);
  if (admin1) {
    console.log(`  Region: ${admin1}`);
  }

  // Get current progress
  const progress = await GRID_MANAGER.getCellProgress(h3Index);
  let currentPage = progress?.currentPage || 0;
  let nextPageToken = progress?.nextPageToken;
  let totalResults = progress?.totalResults || 0;

  // Continue from where we left off
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
        const details = await getPlaceDetails(place.place_id);
        const businessH3 = latLngToCell(
          place.geometry.location.lat,
          place.geometry.location.lng,
          8 // Highest resolution for businesses
        );

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
            openingHours: details?.opening_hours || place.opening_hours || null,
            photos: place.photos || null,
            plusCode: place.plus_code || null,
            icon: place.icon || null,
            iconBackgroundColor: place.icon_background_color || null,
            iconMaskBaseUri: place.icon_mask_base_uri || null,
            priceLevel: place.price_level || null,
            website: details?.website || null,
            phoneNumber: details?.formatted_phone_number || null,
            internationalPhoneNumber:
              details?.international_phone_number || null,
            utcOffset: details?.utc_offset || null,
            h3Index: businessH3,
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
      h3Index,
      resolution,
      latitude: lat.toString(),
      longitude: lng.toString(),
      resultsFound: pageResults,
      pageNumber: currentPage + 1,
    });

    nextPageToken = response.data.next_page_token;
    currentPage++;

    // Update progress
    await GRID_MANAGER.updateCellProgress(
      h3Index,
      currentPage,
      nextPageToken,
      totalResults
    );

    // If no more results, break early
    if (!nextPageToken || pageResults < RESULTS_PER_PAGE) {
      console.log(`    No more results available, stopping early`);
      break;
    }
  }

  console.log(
    `  ✓ Cell completed: ${totalResults} total results across ${currentPage} pages`
  );

  return totalResults;
}

async function main() {
  console.log("Starting Natural Earth-based business search...");

  try {
    // Initialize grid if needed
    const stats = await GRID_MANAGER.getGridStats();
    if (stats.length === 0) {
      console.log("No grid found, initializing from Natural Earth data...");
      await GRID_MANAGER.initializeGermanyGrid();
    }

    // Show current stats
    console.log("\nGrid Statistics:");
    for (const stat of stats) {
      console.log(
        `  Resolution ${stat.resolution}: ${stat.processed}/${stat.total} processed (${stat.exhausted} exhausted)`
      );
    }

    // Process cells one by one
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

      // Decision logic: subdivide if we hit the maximum results threshold
      if (totalResults >= MAX_RESULTS_PER_CELL) {
        console.log(
          `  🔄 Cell ${nextCell.h3Index} hit ${totalResults} results, subdividing...`
        );
        await GRID_MANAGER.subdivideCell(nextCell.h3Index);
      } else {
        console.log(
          `  ✅ Cell ${nextCell.h3Index} completed with ${totalResults} results`
        );
        await GRID_MANAGER.markCellExhausted(nextCell.h3Index);
      }

      // Show updated stats periodically
      if (processedCount % 10 === 0) {
        const updatedStats = await GRID_MANAGER.getGridStats();
        console.log("\nUpdated Grid Statistics:");
        for (const stat of updatedStats) {
          console.log(
            `  Resolution ${stat.resolution}: ${stat.processed}/${stat.total} processed (${stat.exhausted} exhausted)`
          );
        }
      }
    }

    const finalStats = await GRID_MANAGER.getGridStats();
    console.log("\nFinal Grid Statistics:");
    for (const stat of finalStats) {
      console.log(
        `  Resolution ${stat.resolution}: ${stat.processed}/${stat.total} processed (${stat.exhausted} exhausted)`
      );
    }

    console.log("\n✅ Search completed successfully!");
  } catch (error) {
    console.error("Error during search process:", error);
    throw error;
  } finally {
    // Always close the Natural Earth database connection
    GRID_MANAGER.close();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
