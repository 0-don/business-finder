import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { countries, gridCellSchema } from "../db/schema";
import {
  Bounds,
  BoundsRow,
  CoordinateRow,
  Point,
  SettingsConfig,
} from "../types";

dayjs.extend(relativeTime);

class DatabaseManager {
  constructor(private settings: SettingsConfig) {}

  async clearGrid(): Promise<void> {
    await db
      .delete(gridCellSchema)
      .where(eq(gridCellSchema.countryCode, this.settings.countryCode));
  }

  async getValidPlacements(
    candidates: Point[],
    radius: number
  ): Promise<Point[]> {
    if (!candidates.length) return [];

    const valuesSql = candidates.map((p) => `(${p.lng}, ${p.lat})`).join(", ");

    const result = (await db.execute(sql`
      WITH candidates (lng, lat) AS (VALUES ${sql.raw(valuesSql)})
      SELECT c.lng, c.lat FROM candidates c
      JOIN countries co ON co."isoA3" = ${this.settings.countryCode}
      WHERE ST_Within(ST_Buffer(ST_Point(c.lng, c.lat, 4326)::geography, ${radius})::geometry, co.geometry)
      AND NOT EXISTS (
        SELECT 1 FROM grid_cell gc
        WHERE gc.country_code = ${this.settings.countryCode}
        AND ST_DWithin(ST_Point(c.lng, c.lat, 4326)::geography, gc.center::geography, ${radius} + gc.radius_meters)
      )
    `)) as unknown as CoordinateRow[];

    return result.map((row) => ({ lng: +row.lng, lat: +row.lat }));
  }

  async insertCircles(
    circles: Point[],
    radius: number,
    level: number
  ): Promise<void> {
    if (!circles.length) return;

    const values = circles.map((c) => ({
      center: sql`ST_Point(${c.lng}, ${c.lat}, 4326)`,
      radiusMeters: radius,
      circle: sql`ST_Buffer(ST_Point(${c.lng}, ${c.lat}, 4326)::geography, ${radius})::geometry`,
      level,
      countryCode: this.settings.countryCode,
    }));

    await db.insert(gridCellSchema).values(values);
  }

  async getBounds(): Promise<Bounds> {
    const result = (await db.execute(sql`
      SELECT ST_XMin(geometry) as min_x, ST_YMin(geometry) as min_y, 
            ST_XMax(geometry) as max_x, ST_YMax(geometry) as max_y
      FROM countries WHERE "isoA3" = ${this.settings.countryCode}
    `)) as unknown as BoundsRow[];

    if (!result.length) {
      throw new Error(
        `Country ${this.settings.countryCode} not found in database`
      );
    }

    const row = result[0]!;
    return {
      minX: Number(row.min_x),
      minY: Number(row.min_y),
      maxX: Number(row.max_x),
      maxY: Number(row.max_y),
    };
  }
}

class HexGridGenerator {
  private db: DatabaseManager;
  private startTime = dayjs();
  private newCirclesCount = 0;

  constructor(private settings: SettingsConfig) {
    this.db = new DatabaseManager(settings);
  }

  private metersToDegrees(
    meters: number,
    lat = 0
  ): { latDeg: number; lngDeg: number } {
    const latDeg = (meters * 360) / 40008000;
    const lngDeg =
      (meters * 360) / (40075000 * Math.cos((lat * Math.PI) / 180));
    return { latDeg, lngDeg };
  }

  private generateHexCandidates(bounds: Bounds, radius: number): Point[] {
    const candidates: Point[] = [];
    const { latDeg: dyDeg } = this.metersToDegrees(radius * 1.5);

    let y = bounds.minY;
    let row = 0;

    while (y <= bounds.maxY) {
      const { lngDeg: dxDeg } = this.metersToDegrees(radius * 1.73, y);
      const { lngDeg: radiusDegLng } = this.metersToDegrees(radius * 0.866, y);
      const xStart = bounds.minX + (row % 2 === 1 ? radiusDegLng : 0);

      let x = xStart;
      while (x <= bounds.maxX) {
        candidates.push({ lng: x, lat: y });
        x += dxDeg;
      }
      y += dyDeg;
      row++;
    }
    return candidates;
  }

  private async canPlaceAtLeastOne(radius: number): Promise<boolean> {
    const bounds = await this.db.getBounds();
    const candidates = this.generateHexCandidates(bounds, radius);
    return (await this.db.getValidPlacements(candidates, radius)).length > 0;
  }

  private async findNextOptimalRadius(
    maxRadius: number
  ): Promise<number | null> {
    const step = Math.max(
      25,
      Math.floor((maxRadius - this.settings.minRadius) / 30)
    );
    for (
      let radius = maxRadius;
      radius >= this.settings.minRadius;
      radius -= step
    ) {
      if (await this.canPlaceAtLeastOne(radius)) return radius;
    }
    return null;
  }

  private async getCurrentTotalCount(): Promise<number> {
    const result = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(gridCellSchema)
      .where(eq(gridCellSchema.countryCode, this.settings.countryCode));
    return result[0]?.count || 0;
  }

  private async getLowestExistingRadius(): Promise<number | null> {
    const result = await db
      .select({
        minRadius: sql<number>`MIN(${gridCellSchema.radiusMeters})`,
      })
      .from(gridCellSchema)
      .where(eq(gridCellSchema.countryCode, this.settings.countryCode))
      .limit(1);

    return result[0]?.minRadius || null;
  }

  private async generateLevel(radius: number, level: number): Promise<number> {
    const bounds = await this.db.getBounds();
    const candidates = this.generateHexCandidates(bounds, radius);
    const placements = await this.db.getValidPlacements(candidates, radius);
    await this.db.insertCircles(placements, radius, level);

    this.newCirclesCount += placements.length;
    const currentTotal = await this.getCurrentTotalCount();
    const timeAgo = dayjs().from(this.startTime);
    console.log(
      `[${dayjs().format("HH:mm:ss")}] Radius ${radius}m: ${placements.length} circles (total: ${currentTotal}) - ${timeAgo}`
    );

    return placements.length;
  }

  async generateGrid(): Promise<number> {
    console.log(`Starting grid generation for ${this.settings.countryCode}`);

    const existingMinRadius = await this.getLowestExistingRadius();
    let currentRadius = this.settings.maxRadius;

    if (existingMinRadius) {
      currentRadius = Math.floor(existingMinRadius - 1);
      console.log(
        `Resuming grid generation from radius ${currentRadius}m (existing min: ${existingMinRadius}m)`
      );
    }

    let level = 0;

    while (currentRadius && currentRadius >= this.settings.minRadius) {
      await this.generateLevel(currentRadius, level);
      level++;

      if (currentRadius <= this.settings.minRadius) break;

      const nextRadius = await this.findNextOptimalRadius(currentRadius - 1);
      currentRadius =
        nextRadius && nextRadius < currentRadius
          ? nextRadius
          : Math.floor(currentRadius * 0.9);
    }

    const finalTotal = await this.getCurrentTotalCount();
    console.log(
      `Complete! ${finalTotal} total circles (${this.newCirclesCount} new) in ${level} levels`
    );
    return finalTotal;
  }
}

export const getCountryGeometry = async (settings: SettingsConfig) => {
  const result = await db
    .select({
      geojson: sql<string>`ST_AsGeoJSON(geometry)`,
    })
    .from(countries)
    .where(eq(countries.isoA3, settings.countryCode))
    .limit(1);

  return result[0]?.geojson ? JSON.parse(result[0].geojson) : null;
};

export async function generateCountryGrid(
  settings: SettingsConfig
): Promise<number> {
  const generator = new HexGridGenerator(settings);

  try {
    return await generator.generateGrid();
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
}
