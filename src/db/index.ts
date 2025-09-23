import { getTableColumns, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { resolve } from "path";

export const db = drizzlePostgres(process.env.DATABASE_URL!);

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

export async function createPostgreSQLFunctions() {
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION calculate_lng_spacing(lat NUMERIC, radius INTEGER)
    RETURNS NUMERIC AS $$
    BEGIN
      RETURN GREATEST(
        (radius * 2 * 360.0) / (40075000.0 * GREATEST(cos(radians(lat)), 0.1)),
        0.001
      );
    END;
    $$ LANGUAGE plpgsql IMMUTABLE;
  `);
}

await migrate(db, { migrationsFolder: resolve("drizzle") })
  .then(async () => {
    // log("Database migrated successfully");
    // const countryCount = await db
    //   .select({ count: sql<number>`count(*)` })
    //   .from(countries);
    // if (countryCount[0]!.count > 0) return;
    // await createPostgreSQLFunctions();
    // log("Seeding geometry data...");
    // const sqliteDb = createClient({ url: await setupNaturalEarth() });
    // // Seed countries
    // const countryResult = await sqliteDb.execute(
    //   "SELECT name, iso_a3, geometry FROM ne_10m_admin_0_countries WHERE name IS NOT NULL"
    // );
    // const countryValues = countryResult.rows
    //   .map((row) => ({
    //     name: row[0] as string,
    //     isoA3: row[1] as string,
    //     geometry: toPostGisGeometry(row[2] as Uint8Array | null)!,
    //   }))
    //   .filter((val) => val.geometry !== null && val.name?.trim());
    // await db.insert(countries).values(countryValues).onConflictDoNothing();
    // // Seed states/provinces
    // const allPgCountries = await db
    //   .select({ id: countries.id, isoA3: countries.isoA3 })
    //   .from(countries);
    // const countryIsoToIdMap = new Map(
    //   allPgCountries.map((c) => [c.isoA3, c.id])
    // );
    // const stateResult = await sqliteDb.execute(
    //   "SELECT name, iso_3166_2, adm0_a3, geometry FROM ne_10m_admin_1_states_provinces WHERE name IS NOT NULL"
    // );
    // const stateValues = stateResult.rows
    //   .map((row) => {
    //     const countryId = countryIsoToIdMap.get(row[2] as string);
    //     const name = row[0] as string;
    //     if (!countryId || !name?.trim()) return null;
    //     return {
    //       name,
    //       iso_3166_2: row[1] as string,
    //       countryId,
    //       geometry: toPostGisGeometry(row[3] as Uint8Array | null)!,
    //     };
    //   })
    //   .filter(
    //     (val): val is NonNullable<typeof val> =>
    //       val !== null && val.geometry !== null
    //   );
    // await db.insert(statesProvinces).values(stateValues).onConflictDoNothing();
    // log("Geometry data seeded successfully");
  })
  .catch((err) => {
    console.error("Error during migration or seeding:", err);
    process.exit(1);
  });
