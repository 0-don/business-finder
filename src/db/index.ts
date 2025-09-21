import Database from "better-sqlite3";
import { log } from "console";
import { getTableColumns, sql } from "drizzle-orm";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
// import { drizzle } from "drizzle-orm/postgres-js";
// import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { PgTable } from "drizzle-orm/pg-core";
import { resolve } from "path";
import * as naturalEarthSchema from "./natural-earth-schema/schema";

export const db = drizzle(process.env.DATABASE_URL!);

const sqliteDb = new Database("./natural_earth_vector.sqlite", {
  readonly: true,
});

export const naturalEarthDb = drizzleSqlite(sqliteDb, {
  schema: naturalEarthSchema,
});

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

export function closeDatabases() {
  sqliteDb.close();
}
