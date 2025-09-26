import { getTableColumns, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { resolve } from "path";
import postgres from "postgres";
import { extractGADMData } from "../lib/extract-gadm-data";

export const db = drizzlePostgres(
  postgres(process.env.DATABASE_URL, { onnotice: () => {} })
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

export async function createPostgreSQLFunctions() {
  await db.execute(sql`
  CREATE OR REPLACE FUNCTION calculate_lng_spacing(lat NUMERIC, diameter INTEGER)
  RETURNS NUMERIC AS $$
  BEGIN
    RETURN GREATEST(
      (diameter * 360.0) / (40075000.0 * GREATEST(cos(radians(lat)), 0.1)),
      0.001
    );
  END;
  $$ LANGUAGE plpgsql IMMUTABLE;
`);

  // For initial grid creation (country-wide operations)
  await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grid_cell_geom 
    ON grid_cell USING GIST (circle_geometry);
  `);
  await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grid_cell_lat_lng 
    ON grid_cell (latitude, longitude);
  `);

  await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_countries_iso_geom 
    ON countries USING GIST (geometry);
  `);

  // For greedy packing (single cell operations)
  await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grid_cell_id_radius 
    ON grid_cell (id, radius);
  `);

  await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grid_cell_processed 
    ON grid_cell (is_processed) WHERE is_processed IS NOT TRUE;
  `);
}

await migrate(db, { migrationsFolder: resolve("drizzle") })
  .then(async () => {
    await createPostgreSQLFunctions();
    await extractGADMData();
  })
  .catch((err) => {
    console.error("Error during migration or seeding:", err);
    process.exit(1);
  });
