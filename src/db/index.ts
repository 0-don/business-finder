import { createClient } from "@libsql/client";
import { log } from "console";
import { getTableColumns, sql } from "drizzle-orm";
import { drizzle as drizzlePostgres } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import type { PgTable } from "drizzle-orm/pg-core";
import { resolve } from "path";
import * as naturalEarthSchema from "./natural-earth-schema/schema";
// import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
// import { migrate } from "drizzle-orm/postgres-js/migrator";

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

await migrate(db, { migrationsFolder: resolve("drizzle") })
  .then(() => log("Database migrated successfully"))
  .catch(() => process.exit(1));
