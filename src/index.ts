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
    writeFileSync(
      `debug_response_${lat}_${lng}_${pageCount}.json`,
      JSON.stringify(response.data, null, 2)
    );

    pageCount++;

    for (const place of response.data.results) {
      if (place.place_id && place.name && place.geometry?.location) {
        await db
          .insert(businessSchema)
          .values({
            placeId: place.place_id,
            name: place.name,
            address: place.formatted_address || place.vicinity || "",
            rating: (place.rating || 0).toString(),
            userRatingsTotal: place.user_ratings_total || 0,
            latitude: place.geometry.location.lat.toString(),
            longitude: place.geometry.location.lng.toString(),
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
