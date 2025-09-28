import { getTableColumns, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { resolve } from "path";
import postgres from "postgres";
import { extractGADMData } from "../lib/extract-gadm-data";
import { getActiveSettings } from "../lib/settings";

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
  await Promise.all([
    db.execute(sql`
      CREATE EXTENSION IF NOT EXISTS postgis;
    `),

    db.execute(sql`
      CREATE EXTENSION IF NOT EXISTS postgis_topology;
    `),
  ]);
  await Promise.all([
    // Countries indexes
    db.execute(sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_countries_geometry_gist 
      ON countries USING GIST (geometry);
    `),

    db.execute(sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_countries_iso_btree 
      ON countries ("isoA3");
    `),

    // Grid cell - separate spatial and radius indexes (can't mix in GiST)
    db.execute(sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grid_center_gist 
      ON grid_cell USING GIST (center);
    `),

    db.execute(sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grid_radius_btree 
      ON grid_cell (radius_meters);
    `),

    // Grid cell - level index for hierarchical queries
    db.execute(sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grid_level_btree 
      ON grid_cell (level);
    `),

    // Grid cell - partial index for unprocessed cells (efficient for background jobs)
    db.execute(sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grid_unprocessed 
      ON grid_cell (is_processed) 
      WHERE is_processed IS FALSE;
    `),

    // Grid cell - composite index for level + radius combinations
    db.execute(sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grid_level_radius 
      ON grid_cell (level, radius_meters);
    `),

    // GADM subdivisions - geometry index for spatial operations
    db.execute(sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gadm_geometry_gist 
      ON gadm_subdivisions USING GIST (geometry);
    `),

    // GADM subdivisions - ISO code index for country filtering
    db.execute(sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gadm_iso_btree 
      ON gadm_subdivisions ("isoA3");
    `),
  ]);
}

if (!process.env.NODE_ENV) {
  await migrate(db, { migrationsFolder: resolve("drizzle") })
    .then(async () => {
      await createPostgreIndexes();
      const settings = await getActiveSettings();
      await extractGADMData(settings);
    })
    .catch((err) => {
      console.error("Error during migration or seeding:", err);
      process.exit(1);
    });
}
