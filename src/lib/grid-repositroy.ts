import { and, eq, not, sql } from "drizzle-orm";
import { db } from "../db";
import { businessSchema, countries, gridCellSchema } from "../db/schema";
import { Bounds, CountryCode, Point, SettingsConfig, Viewport } from "../types";

export class GridRepository {
  constructor(private settings: SettingsConfig) {}

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

    const values = points.map((p) => sql`(${p.lng}, ${p.lat})`);
    const valuesSql = sql.join(values, sql`, `);

    const results = await db.execute(sql`
      WITH candidates (lng, lat) AS (VALUES ${valuesSql})
      SELECT c.lng, c.lat FROM candidates c
      JOIN countries co ON co."isoA3" = ${countryCode}
      WHERE ST_Within(ST_Buffer(ST_Point(c.lng, c.lat, 4326)::geography, ${radius})::geometry, co.geometry)
      AND NOT EXISTS (
        SELECT 1 FROM grid_cell gc
        WHERE gc.settings_id = ${this.settings.id}
        AND ST_DWithin(ST_Point(c.lng, c.lat, 4326)::geography, gc.center::geography, ${radius} + gc.radius_meters)
      )
    `);

    return results.map((row) => ({
      lng: row.lng as number,
      lat: row.lat as number,
    }));
  }

  async insertCells(
    circles: Array<{ center: Point; radius: number }>,
    level: number
  ): Promise<void> {
    if (!circles.length) return;
    await db.insert(gridCellSchema).values(
      circles.map((c) => ({
        center: sql`ST_Point(${c.center.lng}, ${c.center.lat}, 4326)`,
        radiusMeters: c.radius,
        circle: sql`ST_Buffer(ST_Point(${c.center.lng}, ${c.center.lat}, 4326)::geography, ${c.radius})::geometry`,
        level,
        settingsId: this.settings.id,
      }))
    );
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

  async getObstacles(center: Point, searchRadius: number, excludeId?: number) {
    const bounds = sql`ST_Expand(ST_SetSRID(ST_Point(${center.lng}, ${center.lat}), 4326)::geometry, ${searchRadius / 111320})`;
    return db
      .select({
        center: {
          lng: sql<number>`ST_X(${gridCellSchema.center})`,
          lat: sql<number>`ST_Y(${gridCellSchema.center})`,
        },
        radius: gridCellSchema.radiusMeters,
      })
      .from(gridCellSchema)
      .where(
        excludeId
          ? and(
              not(eq(gridCellSchema.id, excludeId)),
              sql`${gridCellSchema.center} && ${bounds}`
            )
          : sql`${gridCellSchema.center} && ${bounds}`
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
      .orderBy(gridCellSchema.level, gridCellSchema.id)
      .limit(1);
    return cell;
  }

  async updateProgress(
    cellId: number,
    page: number,
    token: string | null
  ): Promise<void> {
    await db
      .update(gridCellSchema)
      .set({ currentPage: page, nextPageToken: token, updatedAt: new Date() })
      .where(eq(gridCellSchema.id, cellId));
  }

  async markProcessed(cellId: number): Promise<void> {
    await db
      .update(gridCellSchema)
      .set({ isProcessed: true, updatedAt: new Date() })
      .where(eq(gridCellSchema.id, cellId));
  }

  async getBusinessCount(cellId: number): Promise<number> {
    const [cell] = await db
      .select({ circle: gridCellSchema.circle })
      .from(gridCellSchema)
      .where(eq(gridCellSchema.id, cellId))
      .limit(1);
    if (!cell) return 0;
    const [result] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(businessSchema)
      .where(sql`ST_Within(${businessSchema.location}, ${cell.circle})`);
    return result?.count || 0;
  }

  async getTotalCount(): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(gridCellSchema)
      .where(eq(gridCellSchema.settingsId, this.settings.id));
    return result?.count || 0;
  }

  async getMinRadius(): Promise<number | null> {
    const [result] = await db
      .select({ min: sql<number>`MIN(${gridCellSchema.radiusMeters})` })
      .from(gridCellSchema)
      .where(eq(gridCellSchema.settingsId, this.settings.id))
      .limit(1);
    return result?.min || null;
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
