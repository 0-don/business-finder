import "@dotenvx/dotenvx/config";
import {
  Client,
  Language,
  PlaceType1,
} from "@googlemaps/google-maps-services-js";
import { writeFileSync } from "fs";
import { conflictUpdateAllExcept, db } from "./db";
import { businessSchema } from "./db/schema";
import { GERMANY_GRID } from "./lib/country-grid";
import { delay } from "./lib/utils";

const client = new Client({});

async function getPlaceDetails(placeId: string) {
  try {
    const response = await client.placeDetails({
      params: {
        place_id: placeId,
        fields: [
          "website",
          "formatted_phone_number",
          "international_phone_number",
          "opening_hours", // More detailed than nearby search
          "utc_offset",
        ],
        language: Language.de,
        key: process.env.GOOGLE_MAPS_API_KEY,
      },
    });

    return response.data.result;
  } catch (error) {
    console.error(`Error fetching details for place ${placeId}:`, error);
    return null;
  }
}

async function searchRegion(lat: number, lng: number) {
  let nextPageToken: string | undefined;
  let pageCount = 0;

  do {
    const response = await client.placesNearby({
      params: {
        location: { lat, lng },
        radius: 50000,
        type: PlaceType1.accounting,
        keyword:
          "tax|steuer|steuerberater|steuerkanzlei|steuerberatung|buchführung|lohnsteuer|wirtschaftsprüfer|finanzbuchhaltung|jahresabschluss|steuererklärung",
        language: Language.de,
        key: process.env.GOOGLE_MAPS_API_KEY,
        ...(nextPageToken && { pagetoken: nextPageToken }),
      },
    });

    pageCount++;

    for (const place of response.data.results) {
      if (place.place_id && place.name && place.geometry?.location) {
        console.log(`Fetching details for: ${place.name}`);

        // Get detailed information (only fields not in nearby search)
        const details = await getPlaceDetails(place.place_id);

        // Write place details response
        writeFileSync(
          `debug_details_${place.place_id}.json`,
          JSON.stringify(details, null, 2)
        );

        await delay(100); // Rate limiting for Place Details API

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
            openingHours: details?.opening_hours || place.opening_hours || null, // Use detailed version if available
            photos: place.photos || null,
            plusCode: place.plus_code || null,
            icon: place.icon || null,
            iconBackgroundColor: place.icon_background_color || null,
            iconMaskBaseUri: place.icon_mask_base_uri || null,
            priceLevel: place.price_level || null,
            // Only these come from Place Details:
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
    if (nextPageToken) await delay(3000);
    else await delay(1000);
  } while (nextPageToken && pageCount < 3);
}

async function main() {
  for (let i = 0; i < GERMANY_GRID.length; i++) {
    const { lat, lng } = GERMANY_GRID[i]!;
    console.log(`Region ${i + 1}/${GERMANY_GRID.length}: (${lat}, ${lng})`);
    await searchRegion(lat, lng);
    await delay(2000);
  }
  console.log("Complete!");
}

main();
