import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { GridRepository } from "../lib/grid-repositroy";
import { SettingsConfig } from "../types";
import { Geometry } from "./geometry";

dayjs.extend(relativeTime);

export class GridGenerator {
  private repo: GridRepository;
  private startTime = dayjs();

  constructor(private settings: SettingsConfig) {
    this.repo = new GridRepository(settings);
  }

  async generate(): Promise<number> {
    console.log(`Starting grid for ${this.settings.countryCode}`);

    const existingMin = await this.repo.getMinRadius();
    let radius = existingMin
      ? Math.floor(existingMin - 1)
      : this.settings.maxRadius;

    if (existingMin) {
      console.log(`Resuming from ${radius}m (existing min: ${existingMin}m)`);
    }

    let level = 0;

    // First level: Use original code-based approach for proper overlap
    if (radius >= this.settings.maxRadius) {
      const insertedCount = await this.generateFirstLevel(radius, level);
      console.log(
        `[${dayjs().format("HH:mm:ss")}] ${radius}m (Level 0 - Code): ${insertedCount} circles (total: ${await this.repo.getTotalCount()}) - ${dayjs().from(this.startTime)}`
      );
      level++;
      radius =
        (await this.findNextRadius(radius - 1)) ?? Math.floor(radius * 0.9);
    }

    // Subsequent levels: Use database-driven approach
    while (radius >= this.settings.minRadius) {
      const insertedCount = await this.generateGridAtRadius(radius, level);

      console.log(
        `[${dayjs().format("HH:mm:ss")}] ${radius}m (Level ${level} - DB): ${insertedCount} circles (total: ${await this.repo.getTotalCount()}) - ${dayjs().from(this.startTime)}`
      );

      level++;
      radius =
        (await this.findNextRadius(radius - 1)) ?? Math.floor(radius * 0.9);
    }

    return this.repo.getTotalCount();
  }

  private async generateFirstLevel(
    radius: number,
    level: number
  ): Promise<number> {
    console.log(
      `Generating first level with code-based approach for proper coverage...`
    );

    const bounds = await this.repo.getBounds(this.settings.countryCode);
    const candidates = Geometry.generateHexGrid(bounds, radius);

    // Process in chunks to avoid memory issues
    const CHUNK_SIZE = 1000;
    let totalInserted = 0;

    for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
      const chunk = candidates.slice(i, i + CHUNK_SIZE);
      const valid = await this.repo.validatePoints(
        chunk,
        radius,
        this.settings.countryCode
      );

      if (valid.length > 0) {
        await this.repo.insertCells(
          valid.map((center) => ({ center, radius })),
          level
        );
        totalInserted += valid.length;
      }
    }

    return totalInserted;
  }

  private async generateGridAtRadius(
    radius: number,
    level: number
  ): Promise<number> {
    const dyDeg = (radius * 1.5 * 360) / 40008000;

    const result = await db.execute(sql`
      WITH 
      country_bounds AS (
        SELECT geometry 
        FROM countries 
        WHERE "isoA3" = ${this.settings.countryCode}
      ),
      hex_grid AS (
        SELECT 
          x + CASE 
            WHEN row_number() OVER (PARTITION BY y ORDER BY x) % 2 = 1 
            THEN ${radius} * 0.866 * 360 / (40075000 * cos(radians(y)))
            ELSE 0 
          END as lng,
          y as lat,
          row_number() OVER (PARTITION BY y ORDER BY x) as row_num
        FROM country_bounds cb,
        LATERAL generate_series(
          ST_XMin(cb.geometry)::numeric, 
          ST_XMax(cb.geometry)::numeric, 
          (${radius} * 1.732 * 360 / (40075000 * cos(radians(ST_YMin(cb.geometry)))))::numeric
        ) AS x,
        LATERAL generate_series(
          ST_YMin(cb.geometry)::numeric,
          ST_YMax(cb.geometry)::numeric, 
          ${dyDeg}::numeric
        ) AS y
      ),
      valid_points AS (
        SELECT 
          hg.lng, 
          hg.lat,
          ST_Point(hg.lng, hg.lat, 4326) as center_point,
          ST_Buffer(ST_Point(hg.lng, hg.lat, 4326)::geography, ${radius})::geometry as circle_geom
        FROM hex_grid hg
        JOIN country_bounds cb ON ST_Within(
          ST_Buffer(ST_Point(hg.lng, hg.lat, 4326)::geography, ${radius})::geometry, 
          cb.geometry
        )
        WHERE NOT EXISTS (
          SELECT 1 FROM grid_cell gc
          WHERE gc.settings_id = ${this.settings.id}
          AND ST_DWithin(
            ST_Point(hg.lng, hg.lat, 4326)::geography, 
            gc.center::geography, 
            ${radius} + gc.radius_meters
          )
        )
      )
      INSERT INTO grid_cell (center, radius_meters, circle, level, settings_id)
      SELECT 
        center_point,
        ${radius}::float8,
        circle_geom,
        ${level},
        ${this.settings.id}
      FROM valid_points
      RETURNING id
    `);

    return result.length;
  }

  private async findNextRadius(maxRadius: number): Promise<number | null> {
    // 1m decrements for maximum precision
    for (let r = maxRadius; r >= this.settings.minRadius; r -= 1) {
      console.log(`Checking viability for radius: ${r}m`);
      const result = (await db.execute(sql`
        WITH test_point AS (
          SELECT ST_Centroid(geometry) as center
          FROM countries 
          WHERE "isoA3" = ${this.settings.countryCode}
        )
        SELECT EXISTS(
          SELECT 1 
          FROM countries c, test_point tp
          WHERE c."isoA3" = ${this.settings.countryCode}
          AND ST_Within(
            ST_Buffer(tp.center::geography, ${r})::geometry, 
            c.geometry
          )
          AND NOT EXISTS (
            SELECT 1 FROM grid_cell gc
            WHERE gc.settings_id = ${this.settings.id}
            AND ST_DWithin(tp.center::geography, gc.center::geography, ${r} + gc.radius_meters)
          )
        ) as viable
      `)) as Array<{ viable: boolean }>;

      if (result[0]?.viable) {
        return r;
      }
    }
    return null;
  }

  async split(cellId: number): Promise<number> {
    const startTime = Date.now();

    const result = await db.execute(sql`
      WITH 
      parent_cell AS (
        SELECT 
          ST_X(center) as lng,
          ST_Y(center) as lat,
          radius_meters,
          level
        FROM grid_cell 
        WHERE id = ${cellId}
      ),
      obstacles AS (
        SELECT center, radius_meters
        FROM grid_cell gc, parent_cell pc
        WHERE gc.id != ${cellId}
        AND gc.settings_id = ${this.settings.id}
        AND ST_DWithin(
          gc.center::geography, 
          ST_Point(pc.lng, pc.lat, 4326)::geography, 
          pc.radius_meters * 3
        )
      ),
      pack_candidates AS (
        SELECT 
          pc.lng + (x * pc.radius_meters / 111320 / cos(radians(pc.lat))) as lng,
          pc.lat + (y * pc.radius_meters / 111320) as lat,
          GREATEST(${this.settings.minRadius}::float8, pc.radius_meters / 2.5) as radius
        FROM parent_cell pc,
        LATERAL generate_series(-1, 1, 0.5) AS x,
        LATERAL generate_series(-1, 1, 0.5) AS y
        WHERE x != 0 OR y != 0
      ),
      valid_candidates AS (
        SELECT 
          pc.lng, pc.lat, pc.radius,
          ST_Point(pc.lng, pc.lat, 4326) as center_point,
          ST_Buffer(ST_Point(pc.lng, pc.lat, 4326)::geography, pc.radius)::geometry as circle_geom,
          (SELECT level FROM parent_cell) + 1 as new_level
        FROM pack_candidates pc
        WHERE pc.radius >= ${this.settings.minRadius}
        AND NOT EXISTS (
          SELECT 1 FROM obstacles o
          WHERE ST_DWithin(
            ST_Point(pc.lng, pc.lat, 4326)::geography,
            o.center::geography,
            pc.radius + o.radius_meters
          )
        )
      ),
      delete_parent AS (
        DELETE FROM grid_cell WHERE id = ${cellId}
      )
      INSERT INTO grid_cell (center, radius_meters, circle, level, settings_id)
      SELECT center_point, radius, circle_geom, new_level, ${this.settings.id}
      FROM valid_candidates
      RETURNING id
    `);

    const duration = Date.now() - startTime;
    console.log(`Split complete: ${result.length} new circles (${duration}ms)`);
    return result.length;
  }
}
