import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { gridCellSchema } from "../db/schema";
import { Bounds, BoundsRow, CoordinateRow, GridConfig, Point } from "../types";

dayjs.extend(relativeTime);

class DatabaseManager {
  constructor(
    private countryCode: string,
    private bounds?: Bounds
  ) {}

  async clearGrid(): Promise<void> {
    await db.execute(sql`DELETE FROM grid_cell`);
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
    JOIN countries co ON co.iso_a3 = ${this.countryCode} 
    WHERE ST_Within(ST_Buffer(ST_Point(c.lng, c.lat, 4326)::geography, ${radius})::geometry, co.geometry)
    AND NOT EXISTS (
      SELECT 1 FROM grid_cell gc
      WHERE ST_DWithin(ST_Point(c.lng, c.lat, 4326)::geography, gc.center::geography, ${radius} + gc.radius_meters)
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
    }));

    await db.insert(gridCellSchema).values(values);
  }

  async getBounds(): Promise<Bounds> {
    if (this.bounds) return this.bounds;

    const result = (await db.execute(sql`
          SELECT ST_XMin(geometry) as min_x, ST_YMin(geometry) as min_y, 
                ST_XMax(geometry) as max_x, ST_YMax(geometry) as max_y
          FROM countries WHERE iso_a3 = ${this.countryCode}
        `)) as unknown as BoundsRow[];

    if (!result.length) {
      throw new Error(`Country ${this.countryCode} not found in database`);
    }

    const row = result[0]!;
    this.bounds = {
      minX: Number(row.min_x),
      minY: Number(row.min_y),
      maxX: Number(row.max_x),
      maxY: Number(row.max_y),
    };
    return this.bounds;
  }
}

class HexGridGenerator {
  private db: DatabaseManager;
  private startTime = dayjs();
  private totalCircles = 0;

  constructor(private config: GridConfig) {
    this.db = new DatabaseManager(config.countryCode);
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

  private async getLowestExistingRadius(): Promise<number | null> {
    const result = await db
      .select({
        minRadius: sql<number>`MIN(${gridCellSchema.radiusMeters})`,
      })
      .from(gridCellSchema)
      .limit(1);

    return result[0]?.minRadius || null;
  }

  private generateHexCandidates(bounds: Bounds, radius: number): Point[] {
    const candidates: Point[] = [];
    // Tighter vertical spacing - reduce from sqrt(3) ≈ 1.732 to 1.5
    const { latDeg: dyDeg } = this.metersToDegrees(radius * 1.5);

    let y = bounds.minY;
    let row = 0;

    while (y <= bounds.maxY) {
      // Tighter horizontal spacing - reduce from 2.0 to 1.73 (sqrt(3))
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
      25, // Smaller steps for more granular radius selection
      Math.floor((maxRadius - this.config.minRadius) / 30)
    );
    for (
      let radius = maxRadius;
      radius >= this.config.minRadius;
      radius -= step
    ) {
      if (await this.canPlaceAtLeastOne(radius)) return radius;
    }
    return null;
  }

  private async generateLevel(radius: number, level: number): Promise<number> {
    const bounds = await this.db.getBounds();
    const candidates = this.generateHexCandidates(bounds, radius);
    const placements = await this.db.getValidPlacements(candidates, radius);
    await this.db.insertCircles(placements, radius, level);

    this.totalCircles += placements.length;
    const timeAgo = dayjs().from(this.startTime);
    console.log(
      `[${dayjs().format("HH:mm:ss")}] Radius ${radius}m: ${placements.length} circles (total: ${this.totalCircles}) - ${timeAgo}`
    );

    return placements.length;
  }

  async generateGrid(): Promise<number> {
    console.log(`Starting grid generation for ${this.config.countryCode}`);

    // Check for existing grid and resume from lowest radius
    const existingMinRadius = await this.getLowestExistingRadius();
    let currentRadius = this.config.maxRadius;

    if (existingMinRadius) {
      // Resume from just below the existing minimum radius
      currentRadius = Math.floor(existingMinRadius - 1);
      console.log(
        `Resuming grid generation from radius ${currentRadius}m (existing min: ${existingMinRadius}m)`
      );

      // Count existing circles for accurate total
      const existingCount = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(gridCellSchema);
      this.totalCircles = existingCount[0]?.count || 0;
    }

    let level = 0;

    while (currentRadius && currentRadius >= this.config.minRadius) {
      await this.generateLevel(currentRadius, level);
      level++;

      if (currentRadius <= this.config.minRadius) break;

      const nextRadius = await this.findNextOptimalRadius(currentRadius - 1);
      currentRadius =
        nextRadius && nextRadius < currentRadius
          ? nextRadius
          : Math.floor(currentRadius * 0.9);
    }

    console.log(
      `Complete! ${this.totalCircles} total circles in ${level} levels`
    );
    return this.totalCircles;
  }
}

export async function generateCountryGrid(
  countryCode: string,
  maxRadius = 50000,
  minRadius = 100
): Promise<number> {
  const generator = new HexGridGenerator({
    countryCode: countryCode.toUpperCase(),
    maxRadius,
    minRadius,
  });
  const db = new DatabaseManager(countryCode);

  try {
    // await db.clearGrid();
    return await generator.generateGrid();
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
}
