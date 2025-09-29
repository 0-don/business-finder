import { Language as GoogleMapsLanguage } from "@googlemaps/google-maps-services-js";
import { CLIENT } from "./lib/constants";
import { getActiveSettings } from "./lib/settings";

export async function exponentialBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 10,
  initialDelay = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxRetries) {
        throw lastError;
      }

      const delay = initialDelay * Math.pow(2, attempt);
      const jitter = Math.random() * 0.1 * delay;
      const totalDelay = delay + jitter;

      console.log(
        `Attempt ${attempt + 1} failed, retrying in ${Math.round(totalDelay)}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, totalDelay));
    }
  }

  throw lastError!;
}

export async function getPlaceDetails(placeId: string) {
  const settings = await getActiveSettings();

  return exponentialBackoff(async () => {
    const response = await CLIENT.placeDetails({
      params: {
        place_id: placeId,
        fields: [
          "website",
          "formatted_phone_number",
          "international_phone_number",
          "opening_hours",
          "utc_offset",
        ],
        language: settings.language as GoogleMapsLanguage,
        key: process.env.GOOGLE_PLACES_API,
      },
    });
    return response.data.result;
  }).catch((error) => {
    console.error(`Error fetching details for place ${placeId}:`, error);
    return null;
  });
}

export async function getPlacesNearby(
  lat: number,
  lng: number,
  radius: number,
  nextPageToken?: string | null
) {
  const settings = await getActiveSettings();

  return await exponentialBackoff(async () => {
    return CLIENT.placesNearby({
      params: {
        location: { lat, lng },
        radius,
        type: settings.placeType,
        keyword: settings.keywords.join("|"),
        language: settings.language as GoogleMapsLanguage,
        key: process.env.GOOGLE_PLACES_API,
        ...(nextPageToken && { pagetoken: nextPageToken }),
      },
    });
  });
}
