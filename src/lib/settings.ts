import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { settingsSchema } from "../db/schema";
import { CountryCode, Language, PlaceType, SettingsConfig } from "../types";
import {
  DEFAULT_COUNTRY_CODE,
  DEFAULT_KEYWORDS,
  DEFAULT_LANGUAGE,
  DEFAULT_PLACE_TYPE,
  MAXIMUM_RADIUS,
  MINIMIUM_RADIUS,
} from "./constants";

export async function getActiveSettings(
  countryCode: CountryCode = DEFAULT_COUNTRY_CODE,
  language: Language = DEFAULT_LANGUAGE,
  placeType: PlaceType = DEFAULT_PLACE_TYPE,
  keywords: string[] = DEFAULT_KEYWORDS
): Promise<SettingsConfig> {
  // First try to find existing settings
  const settings = await db
    .select()
    .from(settingsSchema)
    .where(
      and(
        eq(settingsSchema.countryCode, countryCode),
        eq(settingsSchema.language, language),
        eq(settingsSchema.placeType, placeType),
        eq(settingsSchema.keywords, keywords),
        eq(settingsSchema.isActive, true)
      )
    )
    .limit(1);

  // Return existing settings if found
  if (settings[0]) {
    return {
      id: settings[0].id,
      countryCode: settings[0].countryCode,
      language: settings[0].language,
      placeType: settings[0].placeType,
      keywords: settings[0].keywords,
      maxRadius: settings[0].maxRadius || MAXIMUM_RADIUS,
      minRadius: settings[0].minRadius || MINIMIUM_RADIUS,
    };
  }

  // Create new settings if none exist
  const [newSettings] = await db
    .insert(settingsSchema)
    .values({
      countryCode: countryCode || DEFAULT_COUNTRY_CODE,
      language: language || DEFAULT_LANGUAGE,
      placeType: placeType || DEFAULT_PLACE_TYPE,
      keywords: keywords.length ? keywords : DEFAULT_KEYWORDS,
      maxRadius: MAXIMUM_RADIUS,
      minRadius: MINIMIUM_RADIUS,
      isActive: true,
    })
    .returning();

  return {
    id: newSettings!.id,
    countryCode: newSettings!.countryCode,
    language: newSettings!.language,
    placeType: newSettings!.placeType,
    keywords: newSettings!.keywords,
    maxRadius: newSettings!.maxRadius || MAXIMUM_RADIUS,
    minRadius: newSettings!.minRadius || MINIMIUM_RADIUS,
  };
}
