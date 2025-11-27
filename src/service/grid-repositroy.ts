import { error } from "console";
import { and, count, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { countries, gridCellSchema } from "../db/schema";
import { Bounds, CountryCode, Point, SettingsConfig, Viewport } from "../types";

export class GridRepository {
  constructor(private settings: SettingsConfig) {}

  async getExistingCellsCount(): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(gridCellSchema)
      .where(eq(gridCellSchema.settingsId, this.settings.id));

    return result?.count || 0;
  }

  async getBounds(countryCode: CountryCode): Promise<Bounds> {
    const [result] = await db
      .select({
        minX: sql<number>`ST_XMin(${countries.geometry})`,
        minY: sql<number>`ST_YMin(${countries.geometry})`,
        maxX: sql<number>`ST_XMax(${countries.geometry})`,
        maxY: sql<number>`ST_YMax(${countries.geometry})`,
      })
      .from(countries)
      .where(eq(countries.isoA3, countryCode))
      .limit(1);

    if (!result) throw new Error(`Country ${countryCode} not found`);
    return result;
  }

  async validatePoints(
    points: Point[],
    radius: number,
    countryCode: CountryCode
  ): Promise<Point[]> {
    if (!points.length) return [];

    try {
      const valuesSql = points.map((p) => `(${p.lng}, ${p.lat})`).join(", ");

      return (await db.execute(sql`
      WITH candidates (lng, lat) AS (VALUES ${sql.raw(valuesSql)})
      SELECT c.lng, c.lat FROM candidates c
      JOIN countries co ON co."isoA3" = ${countryCode}
      WHERE ST_Within(ST_Buffer(ST_Point(c.lng, c.lat, 4326)::geography, ${radius})::geometry, co.geometry)
      AND NOT EXISTS (
        SELECT 1 FROM grid_cell gc
        WHERE gc.settings_id = ${this.settings.id}
        AND ST_DWithin(ST_Point(c.lng, c.lat, 4326)::geography, gc.center::geography, ${radius} + gc.radius_meters)
      )
    `)) as unknown as Point[];
    } catch (err) {
      error("Error validating points:", err);
      return [];
    }
  }

  async insertCells(
    circles: Array<{ center: Point; radius: number }>
  ): Promise<void> {
    if (!circles.length) return;

    const BATCH_SIZE = 1000;

    for (let i = 0; i < circles.length; i += BATCH_SIZE) {
      const batch = circles.slice(i, i + BATCH_SIZE);

      await db.insert(gridCellSchema).values(
        batch.map((c) => ({
          center: sql`ST_Point(${c.center.lng}, ${c.center.lat}, 4326)`,
          radiusMeters: c.radius,
          circle: sql`ST_Buffer(ST_Point(${c.center.lng}, ${c.center.lat}, 4326)::geography, ${c.radius})::geometry`,
          level: 0,
          settingsId: this.settings.id,
        }))
      );

      console.log(`Inserted ${i + batch.length}/${circles.length} records`);
    }
  }

  async getCell(cellId: number) {
    const [cell] = await db
      .select({
        id: gridCellSchema.id,
        lat: sql<number>`ST_Y(${gridCellSchema.center})`,
        lng: sql<number>`ST_X(${gridCellSchema.center})`,
        radius: gridCellSchema.radiusMeters,
        level: gridCellSchema.level,
        currentPage: gridCellSchema.currentPage,
        nextPageToken: gridCellSchema.nextPageToken,
      })
      .from(gridCellSchema)
      .where(eq(gridCellSchema.id, cellId))
      .limit(1);
    return cell;
  }

  async getCells(viewport: Viewport, minRadius: number) {
    return await db
      .select({
        id: gridCellSchema.id,
        lat: sql<number>`ST_Y(${gridCellSchema.center})`,
        lng: sql<number>`ST_X(${gridCellSchema.center})`,
        radius: gridCellSchema.radiusMeters,
        level: gridCellSchema.level,
        isProcessed: gridCellSchema.isProcessed,
        businessCount: sql<number>`(
        SELECT COUNT(*)::int 
        FROM business 
        WHERE ST_Within(location, ${gridCellSchema.circle})
        AND settings_id = ${this.settings.id}
      )`,
      })
      .from(gridCellSchema)
      .where(
        sql`
        ST_Intersects(
          ${gridCellSchema.center},
          ST_MakeEnvelope(${viewport.west}, ${viewport.south}, 
                        ${viewport.east}, ${viewport.north}, 4326)
        )
        AND ${gridCellSchema.radiusMeters} >= ${minRadius}
        AND ${gridCellSchema.settingsId} = ${this.settings.id}
      `
      );
  }

  async deleteCell(cellId: number): Promise<void> {
    await db.delete(gridCellSchema).where(eq(gridCellSchema.id, cellId));
  }

  async getNextUnprocessed() {
    const [cell] = await db
      .select()
      .from(gridCellSchema)
      .where(
        and(
          eq(gridCellSchema.settingsId, this.settings.id),
          eq(gridCellSchema.isProcessed, false)
        )
      )
      .orderBy(sql`RANDOM()`)
      .limit(1);
    return cell;
  }

  async markProcessed(cellId: number): Promise<void> {
    await db
      .update(gridCellSchema)
      .set({ isProcessed: true, updatedAt: new Date() })
      .where(eq(gridCellSchema.id, cellId));
  }

  async getCountryGeometry() {
    const [result] = await db
      .select({
        geometry: sql<string>`ST_AsGeoJSON(${countries.geometry})::json`,
      })
      .from(countries)
      .where(eq(countries.isoA3, this.settings.countryCode))
      .limit(1);

    return result?.geometry;
  }
}
