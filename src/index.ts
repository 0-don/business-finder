import "@dotenvx/dotenvx/config";
import { desc, eq } from "drizzle-orm";
import { conflictUpdateAllExcept, db } from "./db";
import {
  businessSchema,
  searchLogSchema,
  searchStateSchema,
} from "./db/schema";
import { GERMANY_GRID, isInGermany } from "./lib/country-grid";
import { delay } from "./lib/utils";

interface BusinessResult {
  name: string;
  address: string;
  rating: number;
  userRatingsTotal: number;
  placeId: string;
  location: { lat: number; lng: number };
}

interface LegacyNearbySearchResponse {
  error_message: string;
  results: Array<{
    place_id: string;
    name: string;
    formatted_address: string;
    rating?: number;
    user_ratings_total?: number;
    geometry: {
      location: {
        lat: number;
        lng: number;
      };
    };
    types: string[];
  }>;
  next_page_token?: string;
  status: string;
}

const MIN_RATING = 4.5;
const MIN_REVIEWS = 20;
const RADIUS = 50000; // 50km max for legacy API

const isGermanSteuerberater = (place: any) => {
  const lat = place.geometry?.location?.lat;
  const lng = place.geometry?.location?.lng;
  if (!lat || !lng || !isInGermany(lat, lng)) return false;

  const types = place.types || [];
  if (!types.includes("accounting")) return false;

  const name = (place.name || "").toLowerCase();
  const address = (place.formatted_address || "").toLowerCase();
  const germanTerms = [
    "steuer",
    "tax",
    "accounting",
    "wirtschaftsprüfung",
    "buchhaltung",
    "beratung",
    "kanzlei",
  ];

  return (
    germanTerms.some((term) => name.includes(term) || address.includes(term)) ||
    address.includes("deutschland") ||
    address.includes("germany") ||
    /\b\d{5}\b/.test(address)
  );
};

async function callLegacyNearbySearchAPI(
  lat: number,
  lng: number,
  pageToken?: string
): Promise<LegacyNearbySearchResponse> {
  const baseUrl =
    "https://maps.googleapis.com/maps/api/place/nearbysearch/json";

  const params = new URLSearchParams({
    location: `${lat},${lng}`,
    radius: RADIUS.toString(),
    type: "accounting",
    language: "de",
    key: process.env.GOOGLE_MAPS_API_KEY,
  });

  if (pageToken) {
    params.append("pagetoken", pageToken);
  }

  const url = `${baseUrl}?${params.toString()}`;

  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `API request failed: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  const data = (await response.json()) as LegacyNearbySearchResponse;

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(
      `API error: ${data.status} - ${data.error_message || "Unknown error"}`
    );
  }

  return data;
}

async function searchRegionWithPagination(
  regionIndex: number,
  lat: number,
  lng: number
) {
  const results: BusinessResult[] = [];
  let nextPageToken: string | undefined;
  let totalPlaces = 0;
  let pageCount = 0;

  console.log(`  Starting paginated search for region ${regionIndex + 1}`);

  do {
    try {
      pageCount++;
      console.log(
        `    Page ${pageCount}${nextPageToken ? ` (token: ${nextPageToken.substring(0, 20)}...)` : ""}`
      );

      const response = await callLegacyNearbySearchAPI(lat, lng, nextPageToken);

      const places = response.results || [];
      totalPlaces += places.length;
      nextPageToken = response.next_page_token;

      console.log(`    Found ${places.length} places on page ${pageCount}`);

      for (const place of places) {
        if (
          place.rating &&
          place.user_ratings_total &&
          place.rating >= MIN_RATING &&
          place.user_ratings_total >= MIN_REVIEWS &&
          isGermanSteuerberater(place)
        ) {
          const result: BusinessResult = {
            name: place.name || "",
            address: place.formatted_address || "",
            rating: place.rating,
            userRatingsTotal: place.user_ratings_total,
            placeId: place.place_id || "",
            location: {
              lat: place.geometry?.location?.lat || 0,
              lng: place.geometry?.location?.lng || 0,
            },
          };

          results.push(result);

          await db
            .insert(businessSchema)
            .values({
              placeId: result.placeId,
              name: result.name,
              address: result.address,
              rating: result.rating.toString(),
              userRatingsTotal: result.userRatingsTotal,
              latitude: result.location.lat.toString(),
              longitude: result.location.lng.toString(),
              businessType: "steuerberater",
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

      // Legacy API requires 2-3 seconds delay for page tokens to become valid
      if (nextPageToken) {
        await delay(3000);
      } else {
        await delay(1000);
      }
    } catch (error) {
      console.error(`    Error on page ${pageCount}:`, error);

      await db.insert(searchLogSchema).values({
        regionIndex,
        latitude: lat.toString(),
        longitude: lng.toString(),
        resultsFound: results.length,
        totalPlaces,
        nextPageToken,
        hasMorePages: !!nextPageToken,
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      break;
    }
  } while (nextPageToken && pageCount < 3); // Legacy API typically has max 3 pages (60 results)

  await db.insert(searchLogSchema).values({
    regionIndex,
    latitude: lat.toString(),
    longitude: lng.toString(),
    resultsFound: results.length,
    totalPlaces,
    hasMorePages: false,
    status: "completed",
  });

  console.log(
    `  Completed region ${regionIndex + 1}: ${results.length} qualifying results from ${totalPlaces} total places across ${pageCount} pages`
  );
  return results;
}

async function initializeOrResumeSearch() {
  const existingState = await db
    .select()
    .from(searchStateSchema)
    .where(eq(searchStateSchema.isComplete, false))
    .orderBy(desc(searchStateSchema.updatedAt))
    .limit(1);

  if (existingState.length > 0) {
    console.log(
      `📋 Resuming previous search from region ${existingState[0]!.currentRegionIndex + 1}/${existingState[0]!.totalRegions}`
    );
    return existingState[0];
  }

  console.log(`🆕 Starting new search across ${GERMANY_GRID.length} regions`);
  const [newState] = await db
    .insert(searchStateSchema)
    .values({
      currentRegionIndex: 0,
      totalRegions: GERMANY_GRID.length,
    })
    .returning();

  return newState;
}

async function updateSearchProgress(
  stateId: number,
  regionIndex: number,
  isComplete = false
) {
  await db
    .update(searchStateSchema)
    .set({
      currentRegionIndex: regionIndex,
      isComplete,
      completedAt: isComplete ? new Date() : undefined,
    })
    .where(eq(searchStateSchema.id, stateId));
}

async function main() {
  try {
    console.log(
      `🔍 Searching for Steuerberater (Rating ≥${MIN_RATING}, Reviews ≥${MIN_REVIEWS})...`
    );

    const searchState = (await initializeOrResumeSearch())!;
    const allResults: BusinessResult[] = [];

    for (let i = searchState.currentRegionIndex; i < GERMANY_GRID.length; i++) {
      const { lat, lng } = GERMANY_GRID[i]!;
      console.log(
        `🌍 Region ${i + 1}/${GERMANY_GRID.length}: (${lat}, ${lng})`
      );

      const regionResults = await searchRegionWithPagination(i, lat, lng);
      allResults.push(...regionResults);

      await updateSearchProgress(searchState.id, i + 1);
      await delay(2000);
    }

    await updateSearchProgress(searchState.id, GERMANY_GRID.length, true);

    console.log(`\n✅ Search Complete!`);
    console.log(`📊 Total results found: ${allResults.length}`);
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

main();
