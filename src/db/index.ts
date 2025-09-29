import { sql } from "drizzle-orm";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { resolve } from "path";
import postgres from "postgres";
import { extractGADMData } from "../lib/extract-gadm-data";
import { getActiveSettings } from "../lib/settings";

export const db = drizzlePostgres(
  postgres(process.env.DATABASE_URL, { onnotice: () => {} })
);

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
    // Countries spatial index
    db.execute(sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_countries_geometry_gist 
      ON countries USING GIST (geometry);
    `),

    // Business location index (removed country_code from GIST index)
    db.execute(sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_business_location_gist 
      ON business USING GIST (location);
    `),

    // Grid cell spatial indexes (removed country_code from GIST index)
    db.execute(sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grid_circle_gist 
      ON grid_cell USING GIST (circle);
    `),

    // GADM subdivisions spatial index
    db.execute(sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gadm_geometry_gist 
      ON gadm_subdivisions USING GIST (geometry);
    `),

    // Add covering index for common spatial queries
    db.execute(sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grid_cell_spatial_covering
      ON grid_cell USING GIST (center, circle)
      WHERE is_processed = false;
    `),

    // Add partial index for unprocessed cells
    db.execute(sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grid_unprocessed
      ON grid_cell (settings_id, level, id)
      WHERE is_processed = false;
    `),
  ]);
}

if (!process.env.DOCKER) {
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
