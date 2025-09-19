import { PlacesClient } from "@google-cloud/places";
import { writeFileSync } from "fs";
import { GERMANY_GRID, isInGermany } from "./lib/country-grid";
import { delay } from "./lib/utils";

interface SteuerberaterResult {
  name: string;
  address: string;
  rating: number;
  userRatingsTotal: number;
  placeId: string;
  location: { lat: number; lng: number };
}

const placesClient = new PlacesClient({
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
});

const MIN_RATING = 4.5;
const MIN_REVIEWS = 20;

const isGermanSteuerberater = (place: any) => {
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  if (!lat || !lng || !isInGermany(lat, lng)) return false;

  const types = place.types || [];
  if (!types.includes('accounting')) return false;

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

async function searchRegion(lat: number, lng: number) {
  const results: SteuerberaterResult[] = [];

  try {
    const request = {
      parent: `projects/${process.env.GOOGLE_CLOUD_PROJECT_ID}/locations/global`,
      locationRestriction: {
        circle: {
          center: {
            latitude: lat,
            longitude: lng,
          },
          radius: 50000,
        },
      },
      includedTypes: ['accounting'],
      languageCode: 'de',
      maxResultCount: 20,
      rankPreference: 'POPULARITY' as const,
    };

    const [response] = await placesClient.searchNearby(request);
    const places = response.places || [];

    for (const place of places) {
      if (
        place.rating &&
        place.userRatingCount &&
        place.rating >= MIN_RATING &&
        place.userRatingCount >= MIN_REVIEWS &&
        isGermanSteuerberater(place)
      ) {
        results.push({
          name: place.displayName?.text || '',
          address: place.formattedAddress || '',
          rating: place.rating,
          userRatingsTotal: place.userRatingCount,
          placeId: place.name?.split('/').pop() || '',
          location: {
            lat: place.location?.latitude || 0,
            lng: place.location?.longitude || 0,
          },
        });
        await delay(200);
      }
    }
  } catch (error) {
    console.error(`Error in region (${lat}, ${lng}):`, error);
  }

  return results;
}

async function main() {
  try {
    console.log(
      `🔍 Searching for Steuerberater (Rating ≥${MIN_RATING}, Reviews ≥${MIN_REVIEWS})...`
    );
    console.log(`Starting search across ${GERMANY_GRID.length} regions...`);
    const allResults: SteuerberaterResult[] = [];

    for (let i = 0; i < GERMANY_GRID.length; i++) {
      const { lat, lng } = GERMANY_GRID[i]!;
      console.log(`Region ${i + 1}/${GERMANY_GRID.length}: ${lat}, ${lng}`);

      const regionResults = await searchRegion(lat, lng);
      allResults.push(...regionResults);
      console.log(`Found ${regionResults.length} results`);
      await delay(1500);
    }

    // Remove duplicates and sort
    const uniqueResults = allResults.filter(
      (result, index, arr) =>
        arr.findIndex((r) => r.placeId === result.placeId) === index
    );

    uniqueResults.sort((a, b) => b.rating - a.rating || b.userRatingsTotal - a.userRatingsTotal);

    writeFileSync(
      "steuerberater_germany.json",
      JSON.stringify(uniqueResults, null, 2)
    );

    console.log(`✅ Found ${uniqueResults.length} unique Steuerberater results`);
    console.log(`📄 Results saved to steuerberater_germany.json`);
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

main();