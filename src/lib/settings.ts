import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { settingsSchema } from "../db/schema";
import { CountryCode, Language, PlaceType, SettingsConfig } from "../types";
import {
  DEFAULT_COUNTRY,
  DEFAULT_KEYWORDS,
  DEFAULT_LANGUAGE,
  DEFAULT_PLACE_TYPE,
} from "./constants";

export async function getActiveSettings(
  countryCode: CountryCode = DEFAULT_COUNTRY,
  language: Language = DEFAULT_LANGUAGE,
  placeType: PlaceType = DEFAULT_PLACE_TYPE,
  keywords: string[] = DEFAULT_KEYWORDS
): Promise<SettingsConfig> {
  const code: CountryCode = countryCode || "DEU";

  const settings = await db
    .select()
    .from(settingsSchema)
    .where(
      and(
        eq(settingsSchema.countryCode, code),
        eq(settingsSchema.language, language),
        eq(settingsSchema.placeType, placeType),
        eq(settingsSchema.isActive, true)
      )
    )
    .limit(1);

  // Return existing settings or defaults
  if (settings[0]) {
    return {
      countryCode: settings[0].countryCode,
      language: settings[0].language,
      placeType: settings[0].placeType,
      keywords: settings[0].keywords,
      maxRadius: settings[0].maxRadius || 50000,
      minRadius: settings[0].minRadius || 100,
    };
  }

  return {
    countryCode: code,
    language: language || DEFAULT_LANGUAGE,
    placeType: placeType || DEFAULT_PLACE_TYPE,
    keywords: keywords.length ? keywords : DEFAULT_KEYWORDS,
    maxRadius: 50000,
    minRadius: 100,
  };
}

export async function createOrUpdateSettings(
  config: SettingsConfig
): Promise<void> {
  await db
    .insert(settingsSchema)
    .values({
      countryCode: config.countryCode,
      language: config.language,
      placeType: config.placeType,
      keywords: config.keywords,
      maxRadius: config.maxRadius,
      minRadius: config.minRadius,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: [
        settingsSchema.countryCode,
        settingsSchema.language,
        settingsSchema.placeType,
        settingsSchema.keywords,
      ],
      set: {
        maxRadius: config.maxRadius,
        minRadius: config.minRadius,
        isActive: true,
        updatedAt: new Date(),
      },
    });
}
