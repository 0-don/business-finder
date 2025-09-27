import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { countries } from "../db/schema";

export class GridManager {
  countryCode: string;

  constructor(countryCode: string) {
    this.countryCode = countryCode;
  }

  async getCountryGeometry() {
    const result = await db
      .select({
        geojson: sql<string>`ST_AsGeoJSON(geometry)`,
      })
      .from(countries)
      .where(eq(countries.isoA3, this.countryCode))
      .limit(1);
    return result[0]?.geojson ? JSON.parse(result[0].geojson) : null;
  }
}
