import "@dotenvx/dotenvx/config";
import {
  Client,
  Language,
  PlaceType1,
} from "@googlemaps/google-maps-services-js";
import { conflictUpdateAllExcept, db } from "./db";
import { businessSchema, searchLogSchema } from "./db/schema";
import { GERMANY_POPULATION_GRID, type GridCell } from "./lib/germany-grid";
import {
  exponentialBackoff,
  getSearchState,
  updateSearchState,
} from "./lib/utils";

const client = new Client({});

async function getPlaceDetails(placeId: string) {
  return exponentialBackoff(async () => {
    const response = await client.placeDetails({
      params: {
        place_id: placeId,
        fields: [
          "website",
          "formatted_phone_number",
          "international_phone_number",
          "opening_hours",
          "utc_offset",
        ],
        language: Language.de,
        key: process.env.GOOGLE_MAPS_API_KEY,
      },
    });
    return response.data.result;
  }).catch((error) => {
    console.error(`Error fetching details for place ${placeId}:`, error);
    return null;
  });
}

async function searchRegion(
  gridCell: GridCell,
  regionIndex: number,
  startPageIndex = 0,
  startPageToken?: string | null
) {
  let totalResults = 0;
  let nextPageToken: string | undefined = startPageToken || undefined;
  let pageCount = startPageIndex;

  const { lat, lng, radius, cellSize, populationDensity, nearestCity } =
    gridCell;

  console.log(
    `  Searching ${populationDensity} density area near ${nearestCity || "rural"}`
  );
  console.log(`  Cell: ${cellSize}km, Radius: ${radius / 1000}km`);

  do {
    console.log(`    Page ${pageCount + 1}`);

    const response = await exponentialBackoff(async () => {
      return client.placesNearby({
        params: {
          location: { lat, lng },
          radius,
          type: PlaceType1.accounting,
          keyword:
            "tax|steuer|steuerberater|steuerkanzlei|steuerberatung|buchführung|lohnsteuer|wirtschaftsprüfer|finanzbuchhaltung|jahresabschluss|steuererklärung",
          language: Language.de,
          key: process.env.GOOGLE_MAPS_API_KEY,
          ...(nextPageToken && { pagetoken: nextPageToken }),
        },
      });
    });

    const pageResults = response.data.results.length;
    totalResults += pageResults;
    console.log(`      ${pageResults} results`);

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
    pageCount++;

    await updateSearchState(regionIndex, pageCount, nextPageToken);
  } while (nextPageToken && pageCount < 3);

  await db.insert(searchLogSchema).values({
    regionIndex,
    latitude: lat.toString(),
    longitude: lng.toString(),
    resultsFound: totalResults,
  });

  console.log(`    ✓ Region completed: ${totalResults} total results`);
  return totalResults;
}

async function main() {
  console.log("Starting population-based business search...");
  console.log(`Total regions to search: ${GERMANY_POPULATION_GRID.length}`);

  const state = await getSearchState();
  console.log(
    `Resuming from region ${state.regionIndex + 1}/${GERMANY_POPULATION_GRID.length}, page ${state.pageIndex + 1}`
  );

  for (let i = state.regionIndex; i < GERMANY_POPULATION_GRID.length; i++) {
    const gridCell = GERMANY_POPULATION_GRID[i]!;

    console.log(`\nRegion ${i + 1}/${GERMANY_POPULATION_GRID.length}:`);
    console.log(`  Location: (${gridCell.lat}, ${gridCell.lng})`);
    console.log(
      `  Type: ${gridCell.populationDensity} density (${gridCell.cellSize}km cells)`
    );

    const startPageIndex = i === state.regionIndex ? state.pageIndex : 0;
    const startPageToken =
      i === state.regionIndex ? state.nextPageToken : undefined;

    await searchRegion(
      gridCell,
      i,
      startPageIndex,
      startPageToken || undefined
    );

    await updateSearchState(i + 1, 0, null);
  }

  console.log("\n🎉 Population-based search completed!");
}

main().catch(console.error);
