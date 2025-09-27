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

export async function createPostgreIndexes() {
   await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_countries_geometry_gist 
    ON countries USING GIST (geometry);
  `);

  await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_countries_iso_btree 
    ON countries (iso_a3);
  `);

  // Grid cell indexes for the new schema
  await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grid_center_gist 
    ON grid_cell USING GIST (center);
  `);

  await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grid_circle_gist 
    ON grid_cell USING GIST (circle);
  `);

  await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grid_radius_btree 
    ON grid_cell (radius_meters);
  `);

  await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grid_level_btree 
    ON grid_cell (level);
  `);

  // Composite index for common query patterns
  await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grid_level_radius 
    ON grid_cell (level, radius_meters);
  `);

  // Business location index for the new schema
  await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_business_location_gist 
    ON business USING GIST (location);
  `);

  await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_business_place_id_btree 
    ON business (place_id);
  `);

  // Processing status index (if you still need it)
  await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grid_processed 
    ON grid_cell (is_processed) 
    WHERE is_processed IS FALSE;
  `);
}

await migrate(db, { migrationsFolder: resolve("drizzle") })
  .then(async () => {
    await createPostgreIndexes();
    await extractGADMData();
  })
  .catch((err) => {
    console.error("Error during migration or seeding:", err);
    process.exit(1);
  });
