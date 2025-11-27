import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { settingsSchema } from "../db/schema";
import { CountryCode, SettingsConfig } from "../types";
import { DEFAULT_COUNTRY_CODE, DEFAULT_PLACE_TYPE } from "./constants";

export async function getActiveSettings(
  countryCode: CountryCode = DEFAULT_COUNTRY_CODE,
  placeType: string = DEFAULT_PLACE_TYPE
): Promise<SettingsConfig> {
  const [existing] = await db
    .select()
    .from(settingsSchema)
    .where(
      and(
        eq(settingsSchema.countryCode, countryCode),
        eq(settingsSchema.placeType, placeType),
        eq(settingsSchema.isActive, true)
      )
    )
    .limit(1);

  if (existing) {
    return {
      id: existing.id,
      countryCode: existing.countryCode,
      placeType: existing.placeType,
    };
  }

  const [created] = await db
    .insert(settingsSchema)
    .values({
      countryCode,
      placeType,
      isActive: true,
    })
    .returning();

  if (!created) throw new Error("Failed to create settings");

  return {
    id: created.id,
    countryCode: created.countryCode,
    placeType: created.placeType,
  };
}
