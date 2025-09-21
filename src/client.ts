import { Language } from "@googlemaps/google-maps-services-js";
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
