import "@dotenvx/dotenvx/config";
import { and, eq, sql } from "drizzle-orm";
import { getPlaceDetails, getPlacesNearby } from "./client";
import { db } from "./db";
import { businessSchema, gridCellSchema } from "./db/schema";
import { splitGridCell } from "./lib/circle-packing";
import {
  MAX_PAGES_PER_CELL,
  MAX_RESULTS_PER_CELL,
  RESULTS_PER_PAGE,
} from "./lib/constants";
import { extractGADMData } from "./lib/extract-gadm-data";
import { getActiveSettings } from "./lib/settings";
import { SettingsConfig } from "./types";

async function getNextUnprocessedCell(settings: SettingsConfig) {
  const result = await db
    .select()
    .from(gridCellSchema)
    .where(
      and(
        eq(gridCellSchema.settingsId, settings.id),
        eq(gridCellSchema.isProcessed, false)
      )
    )
    .orderBy(gridCellSchema.level, gridCellSchema.id)
    .limit(1);

  return result[0] || null;
}

async function updateCellProgress(
  cellId: number,
  currentPage: number,
  nextPageToken: string | null
): Promise<void> {
  await db
    .update(gridCellSchema)
    .set({
      currentPage,
      nextPageToken,
      updatedAt: new Date(),
    })
    .where(eq(gridCellSchema.id, cellId));
}

async function markCellProcessed(cellId: number): Promise<void> {
  await db
    .update(gridCellSchema)
    .set({
      isProcessed: true,
      updatedAt: new Date(),
    })
    .where(eq(gridCellSchema.id, cellId));
}

async function getBusinessCountInCell(cellId: number): Promise<number> {
  const cell = await db
    .select({ circle: gridCellSchema.circle })
    .from(gridCellSchema)
    .where(eq(gridCellSchema.id, cellId))
    .limit(1);

  if (!cell[0]) return 0;

  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(businessSchema)
    .where(sql`ST_Within(${businessSchema.location}, ${cell[0].circle})`);

  return result[0]?.count || 0;
}

async function searchGridCell(
  gridCell: typeof gridCellSchema.$inferSelect,
  settings: SettingsConfig
): Promise<number> {
  const lat = await db
    .select({ lat: sql<number>`ST_Y(${gridCellSchema.center})` })
    .from(gridCellSchema)
    .where(eq(gridCellSchema.id, gridCell.id))
    .limit(1);

  const lng = await db
    .select({ lng: sql<number>`ST_X(${gridCellSchema.center})` })
    .from(gridCellSchema)
    .where(eq(gridCellSchema.id, gridCell.id))
    .limit(1);

  if (!lat[0] || !lng[0]) return 0;

  console.log(
    `Searching cell ${gridCell.id} (L${gridCell.level}) - ${lat[0].lat.toFixed(3)},${lng[0].lng.toFixed(3)} R:${gridCell.radiusMeters}m`
  );

  let currentPage = gridCell.currentPage || 0;
  let nextPageToken = gridCell.nextPageToken;
  let pageResults = 0;

  while (currentPage < MAX_PAGES_PER_CELL) {
    const response = await getPlacesNearby(
      lat[0].lat,
      lng[0].lng,
      gridCell.radiusMeters,
      nextPageToken
    );
    pageResults = response.data.results.length;

    if (pageResults > 0) {
      console.log(`  Page ${currentPage + 1}: ${pageResults} results`);
    }

    for (const place of response.data.results) {
      if (place.place_id && place.name && place.geometry?.location) {
        const details = await getPlaceDetails(place.place_id);

        await db
          .insert(businessSchema)
          .values({
            placeId: place.place_id,
            name: place.name,
            address: place.formatted_address || place.vicinity || "",
            vicinity: place.vicinity || null,
            formattedAddress: place.formatted_address || null,
            rating: place.rating || null,
            userRatingsTotal: place.user_ratings_total || 0,
            location: sql`ST_SetSRID(ST_Point(${place.geometry.location.lng}, ${place.geometry.location.lat}), 4326)`,
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
            settingsId: settings.id,
          })
          .onConflictDoNothing();
      }
    }

    nextPageToken = response.data.next_page_token || null;
    currentPage++;

    await updateCellProgress(gridCell.id, currentPage, nextPageToken);

    if (!nextPageToken || pageResults < RESULTS_PER_PAGE) break;
  }

  const totalResults = await getBusinessCountInCell(gridCell.id);
  console.log(`  Complete: ${totalResults} total businesses in cell`);
  return totalResults;
}

async function main() {
  console.log("Starting business search...");

  const settings = await getActiveSettings();
  await extractGADMData(settings);

  let processedCount = 0;

  while (true) {
    const nextCell = await getNextUnprocessedCell(settings);

    if (!nextCell) {
      console.log("All cells processed!");
      break;
    }

    processedCount++;
    const totalResults = await searchGridCell(nextCell, settings);

    if (totalResults >= MAX_RESULTS_PER_CELL) {
      console.log(
        `  Subdividing cell ${nextCell.id} (${totalResults} >= ${MAX_RESULTS_PER_CELL})`
      );
      await splitGridCell(settings, nextCell.id);
    } else {
      await markCellProcessed(nextCell.id);
    }
  }

  console.log(`Search completed! Processed ${processedCount} cells.`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
