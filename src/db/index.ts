import Database from "better-sqlite3";
import { log } from "console";
import { getTableColumns, sql } from "drizzle-orm";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzlePostgres } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import type { PgTable } from "drizzle-orm/pg-core";
import { resolve } from "path";
import * as naturalEarthSchema from "./natural-earth-schema/schema";
// import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
// import { migrate } from "drizzle-orm/postgres-js/migrator";

export const db = drizzlePostgres(process.env.DATABASE_URL!);

export const naturalEarthDb = drizzleSqlite(
  new Database("natural_earth_vector.sqlite", { readonly: true }),
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

await migrate(db, { migrationsFolder: resolve("drizzle") })
  .then(() => log("Database migrated successfully"))
  .catch(() => process.exit(1));
