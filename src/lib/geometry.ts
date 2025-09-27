import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { countries } from "../db/schema";

export const getCountryGeometry = async (countryCode: string) => {
  const result = await db
    .select({
      geojson: sql<string>`ST_AsGeoJSON(geometry)`,
    })
    .from(countries)
    .where(eq(countries.isoA3, countryCode))
    .limit(1);

  return result[0]?.geojson ? JSON.parse(result[0].geojson) : null;
};
