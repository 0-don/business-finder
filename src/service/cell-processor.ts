import { sql } from "drizzle-orm";
import { getPlaceDetails, getPlacesNearby } from "../client";
import { db } from "../db";
import { businessSchema } from "../db/schema";
import {
  MAX_PAGES_PER_CELL,
  MAX_RESULTS_PER_CELL,
  RESULTS_PER_PAGE,
} from "../lib/constants";
import { GridRepository } from "../lib/grid-repositroy";
import { SettingsConfig } from "../types";

export class CellProcessor {
  private repo: GridRepository;

  constructor(private settings: SettingsConfig) {
    this.repo = new GridRepository(settings);
  }

  async processNext(): Promise<{ needsSplit: boolean; cellId: number } | null> {
    const cell = await this.repo.getNextUnprocessed();
    if (!cell) return null;

    const count = await this.searchCell(cell.id);

    if (count >= MAX_RESULTS_PER_CELL) {
      return { needsSplit: true, cellId: cell.id };
    }

    await this.repo.markProcessed(cell.id);
    return { needsSplit: false, cellId: cell.id };
  }

  private async searchCell(cellId: number): Promise<number> {
    const cell = await this.repo.getCell(cellId);
    if (!cell) return 0;

    console.log(
      `Searching cell ${cellId} (L${cell.level}) - ${cell.lat.toFixed(3)},${cell.lng.toFixed(3)} :${cell.radius}m`
    );
    let page = cell.currentPage || 0;
    let token = cell.nextPageToken;

    try {
      while (page < MAX_PAGES_PER_CELL) {
        const res = await getPlacesNearby(
          cell.lat,
          cell.lng,
          cell.radius,
          token
        );
        if (res.data.results.length > 0)
          console.log(`  Page ${page + 1}: ${res.data.results.length} results`);

        for (const place of res.data.results) {
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
                openingHours:
                  details?.opening_hours || place.opening_hours || null,
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
                settingsId: this.settings.id,
              })
              .onConflictDoNothing();
          }
        }

        token = res.data.next_page_token || null;
        page++;
        await this.repo.updateProgress(cellId, page, token);
        if (!token || res.data.results.length < RESULTS_PER_PAGE) break;
      }
    } catch (err) {
      console.error(`Error searching cell ${cellId}:`, err);
      throw err;
    }

    const total = await this.repo.getBusinessCount(cellId);
    console.log(`  Complete: ${total} businesses`);
    return total;
  }
}
