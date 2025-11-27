import { sql } from "drizzle-orm";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { resolve } from "path";
import postgres from "postgres";

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

  // Create indexes sequentially to avoid deadlocks
  await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_countries_geometry_gist 
    ON countries USING GIST (geometry);
  `);

  await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_business_location_gist 
    ON business USING GIST (location);
  `);

  await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grid_circle_gist 
    ON grid_cell USING GIST (circle);
  `);

  await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gadm_geometry_gist 
    ON gadm_subdivisions USING GIST (geometry);
  `);

  await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grid_cell_spatial_covering
    ON grid_cell USING GIST (center, circle)
    WHERE is_processed = false;
  `);

  await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grid_unprocessed
    ON grid_cell (settings_id, level, id)
    WHERE is_processed = false;
  `);
}

await migrate(db, { migrationsFolder: resolve("drizzle") })
  .then(createPostgreIndexes)
  .catch((err) => {
    console.error("Error during migration or seeding:", err);
    process.exit(1);
  });
