// src/index.ts
import "@dotenvx/dotenvx/config";
import type { google } from "@googlemaps/places/build/protos/protos";
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

interface TextSearchRequest {
  textQuery: string;
  pageSize?: number;
  languageCode?: string;
  includedType?: string;
  locationBias?: {
    circle: {
      center: { latitude: number; longitude: number };
      radius: number;
    };
  };
  pageToken?: string;
}

interface TextSearchResponse {
  places?: google.maps.places.v1.IPlace[];
  nextPageToken?: string;
}

const MIN_RATING = 4.5;
const MIN_REVIEWS = 20;
const MAX_RESULTS_PER_REQUEST = 20;

const isGermanSteuerberater = (place: google.maps.places.v1.IPlace) => {
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  if (!lat || !lng || !isInGermany(lat, lng)) return false;

  const types = place.types || [];
  if (!types.includes("accounting")) return false;

  const name = (place.displayName?.text || "").toLowerCase();
  const address = (place.formattedAddress || "").toLowerCase();
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

async function callTextSearchAPI(
  textQuery: string,
  locationBias?: TextSearchRequest["locationBias"],
  pageToken?: string
): Promise<TextSearchResponse> {
  const url = "https://places.googleapis.com/v1/places:searchText";

  const requestBody: TextSearchRequest = {
    textQuery,
    pageSize: MAX_RESULTS_PER_REQUEST,
    languageCode: "de",
    includedType: "accounting",
  };

  if (locationBias) {
    requestBody.locationBias = locationBias;
  }

  if (pageToken) {
    requestBody.pageToken = pageToken;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY!,
      "X-Goog-FieldMask":
        "places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.location,places.types,places.id,nextPageToken",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `API request failed: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  return response.json() as Promise<TextSearchResponse>;
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

      const textQuery = `Steuerberater accounting near ${lat},${lng}`;

      const locationBias = {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: 50000,
        },
      };

      const response = await callTextSearchAPI(
        textQuery,
        locationBias,
        nextPageToken
      );

      const places = response.places || [];
      totalPlaces += places.length;
      nextPageToken = response.nextPageToken;

      console.log(`    Found ${places.length} places on page ${pageCount}`);

      for (const place of places) {
        if (
          place.rating &&
          place.userRatingCount &&
          place.rating >= MIN_RATING &&
          place.userRatingCount >= MIN_REVIEWS &&
          isGermanSteuerberater(place)
        ) {
          const result: BusinessResult = {
            name: place.displayName?.text || "",
            address: place.formattedAddress || "",
            rating: place.rating,
            userRatingsTotal: place.userRatingCount,
            placeId: place.id || "",
            location: {
              lat: place.location?.latitude || 0,
              lng: place.location?.longitude || 0,
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
  } while (nextPageToken && pageCount < 5);

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
