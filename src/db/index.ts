import { createClient } from "@libsql/client";
import { log } from "console";
import { getTableColumns, sql } from "drizzle-orm";
import { drizzle as drizzlePostgres } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import type { PgTable } from "drizzle-orm/pg-core";
import { resolve } from "path";
import * as naturalEarthSchema from "./natural-earth-schema/schema";

export const db = drizzlePostgres(process.env.DATABASE_URL!);

export const naturalEarthDb = drizzleLibsql(
  createClient({ url: "file:natural_earth_vector.sqlite" }),
  { schema: naturalEarthSchema }
);

export function conflictUpdateAllExcept<
  T extends PgTable,
  E extends (keyof T["$inferInsert"])[],
>(table: T, except: E) {
  const columns = getTableColumns(table);
  const updateColumns = Object.entries(columns).filter(
    ([col]) => !except.includes(col as keyof typeof table.$inferInsert)
  );

  return updateColumns.reduce(
    (acc, [colName, column]) => ({
      ...acc,
      [colName]: sql.raw(`excluded."${column.name}"`),
    }),
    {}
  );
}

// function toPostGisGeometry(wkbData: Uint8Array | null) {
//   if (!wkbData) return null;
//   try {
//     const buffer = Buffer.from(wkbData);
//     const geometry = Geometry.parse(buffer);
//     const geoJson = geometry.toGeoJSON() as GeoJSONGeometry;

//     if (geoJson.type === "Polygon") {
//       geoJson.type = "MultiPolygon";
//       geoJson.coordinates = [geoJson.coordinates as number[][][]];
//     }

//     return sql`ST_GeogFromText(${geometry.toWkt()})`;
//   } catch (e) {
//     return null;
//   }
// }

await migrate(db, { migrationsFolder: resolve("drizzle") })
  .then(async () => {
    log("Database migrated successfully");

    // // Check if geometry data already exists
    // const countryCount = await db
    //   .select({ count: sql<number>`count(*)` })
    //   .from(countries);
    // if (countryCount[0]!.count > 0) return;

    // log("Seeding geometry data...");
    // const dbPath = await downloadNaturalEarthDB();
    // const sqliteDb = createClient({ url: dbPath });

    // // Seed countries
    // const countryResult = await sqliteDb.execute(
    //   "SELECT name, iso_a3, geometry FROM ne_10m_admin_0_countries"
    // );
    // const countryValues = countryResult.rows
    //   .map((row) => ({
    //     name: row[0] as string,
    //     isoA3: row[1] as string,
    //     geometry: toPostGisGeometry(row[2] as Uint8Array | null)!,
    //   }))
    //   .filter((val) => val.geometry !== null);

    // await db.insert(countries).values(countryValues);

    // // Seed states/provinces
    // const allPgCountries = await db
    //   .select({ id: countries.id, isoA3: countries.isoA3 })
    //   .from(countries);
    // const countryIsoToIdMap = new Map(
    //   allPgCountries.map((c) => [c.isoA3, c.id])
    // );

    // const stateResult = await sqliteDb.execute(
    //   "SELECT name, iso_3166_2, adm0_a3, geometry FROM ne_10m_admin_1_states_provinces"
    // );
    // const stateValues = stateResult.rows
    //   .map((row) => {
    //     const countryId = countryIsoToIdMap.get(row[2] as string);
    //     if (!countryId) return null;

    //     return {
    //       name: row[0] as string,
    //       iso_3166_2: row[1] as string,
    //       countryId,
    //       geometry: toPostGisGeometry(row[3] as Uint8Array | null)!,
    //     };
    //   })
    //   .filter(
    //     (val): val is NonNullable<typeof val> =>
    //       val !== null && val.geometry !== null
    //   );

    // await db.insert(statesProvinces).values(stateValues);
    // log("Geometry data seeded successfully");
  })
  .catch(() => process.exit(1));
