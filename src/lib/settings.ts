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
  const [existing] = await db
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

  if (existing) {
    return {
      id: existing.id,
      countryCode: existing.countryCode,
      language: existing.language,
      placeType: existing.placeType,
      keywords: existing.keywords,
      maxRadius: existing.maxRadius ?? MAXIMUM_RADIUS,
      minRadius: existing.minRadius ?? MINIMIUM_RADIUS,
    };
  }

  const [created] = await db
    .insert(settingsSchema)
    .values({
      countryCode,
      language,
      placeType,
      keywords: keywords.length ? keywords : DEFAULT_KEYWORDS,
      maxRadius: MAXIMUM_RADIUS,
      minRadius: MINIMIUM_RADIUS,
      isActive: true,
    })
    .returning();

  if (!created) throw new Error("Failed to create settings");

  return {
    id: created.id,
    countryCode: created.countryCode,
    language: created.language,
    placeType: created.placeType,
    keywords: created.keywords,
    maxRadius: created.maxRadius ?? MAXIMUM_RADIUS,
    minRadius: created.minRadius ?? MINIMIUM_RADIUS,
  };
}
