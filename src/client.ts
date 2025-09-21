import { Language, PlaceType1 } from "@googlemaps/google-maps-services-js";
import { CLIENT } from "./lib/constants";
import { exponentialBackoff } from "./lib/utils";

export async function getPlaceDetails(placeId: string) {
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
        language: Language.de,
        key: process.env.GOOGLE_MAPS_API_KEY!,
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
  return await exponentialBackoff(async () => {
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
}
