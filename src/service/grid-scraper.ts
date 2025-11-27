import { PuppeteerBlocker } from "@ghostery/adblocker-puppeteer";
import { eq, sql } from "drizzle-orm";
import { Page } from "puppeteer";
import { connect } from "puppeteer-real-browser";
import { db } from "../db";
import { businessSchema } from "../db/schema";
import { setupCleanup } from "../lib/scrape/cleanup";
import { extractBusinessDetails } from "../lib/scrape/extract";
import { scrollToLoadAll } from "../lib/scrape/scroll";
import { SettingsConfig } from "../types";
import { GridRepository } from "./grid-repositroy";

interface BusinessDetails {
  id: string;
  name: string;
  businessType: string | null;
  reviewScore: number | null;
  reviewCount: number | null;
  address: string | null;
  phone: string | null;
  website: string | null;
}

export class GridScraper {
  private repo: GridRepository;
  private page: any;
  private browser: any;
  private cleanup: () => Promise<void>;

  constructor(private settings: SettingsConfig) {
    this.repo = new GridRepository(settings);
  }

  async initialize(): Promise<void> {
    const { page, browser } = await connect({
      headless: false,
      turnstile: true,
      disableXvfb: true,
    });

    this.page = page;
    this.browser = browser;
    this.cleanup = await setupCleanup(browser, page);

    PuppeteerBlocker.fromPrebuiltAdsAndTracking(fetch).then((b) =>
      b.enableBlockingInPage(page as unknown as Page)
    );
  }

  async processNextCell(): Promise<{
    cellId: number;
    businessCount: number;
  } | null> {
    const cell = await this.repo.getNextUnprocessed();
    if (!cell) return null;

    const cellData = await this.repo.getCell(cell.id);
    if (!cellData) return null;

    console.log(
      `Processing cell ${cell.id} (L${cellData.level}) - ${cellData.lat.toFixed(3)},${cellData.lng.toFixed(3)} :${cellData.radius}m`
    );

    try {
      const businesses = await this.scrapeCell(cellData);
      const savedCount = await this.saveBusinesses(businesses, cellData);
      await this.repo.markProcessed(cell.id);

      console.log(
        `Cell ${cell.id} complete: ${savedCount} new businesses saved`
      );
      return { cellId: cell.id, businessCount: savedCount };
    } catch (error) {
      console.error(`Error processing cell ${cell.id}:`, error);
      throw error;
    }
  }

  private async scrapeCell(cellData: any): Promise<BusinessDetails[]> {
    const url = `https://www.google.com/maps/search/${encodeURIComponent(this.settings.placeType)}/@${cellData.lat},${cellData.lng},15z?hl=en`;

    let retries = 3;
    while (retries > 0) {
      try {
        await this.page.goto(url, { timeout: 15000 });

        if (await scrollToLoadAll(this.page)) {
          return await extractBusinessDetails(this.page);
        }

        console.log(
          `Infinite loading detected for cell ${cellData.id}, retrying...`
        );
        retries--;
      } catch (error) {
        console.error(
          `Attempt failed for cell ${cellData.id}, ${retries - 1} retries left`
        );
        retries--;
        if (retries === 0) throw error;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    return [];
  }

  private async saveBusinesses(
    businesses: BusinessDetails[],
    cellData: any
  ): Promise<number> {
    let savedCount = 0;

    for (const business of businesses) {
      try {
        const [existing] = await db
          .select({ placeId: businessSchema.placeId })
          .from(businessSchema)
          .where(eq(businessSchema.placeId, business.id))
          .limit(1);

        if (existing) continue;

        await db
          .insert(businessSchema)
          .values({
            placeId: business.id,
            name: business.name,
            address: business.address || business.businessType || "",
            vicinity: business.address || null,
            formattedAddress: business.address || null,
            rating: business.reviewScore || null,
            userRatingsTotal: business.reviewCount || 0,
            location: sql`ST_Point(${cellData.lng}, ${cellData.lat}, 4326)`,
            businessStatus: null,
            types: business.businessType ? [business.businessType] : null,
            openingHours: null,
            photos: null,
            plusCode: null,
            icon: null,
            iconBackgroundColor: null,
            iconMaskBaseUri: null,
            priceLevel: null,
            website: business.website || null,
            phoneNumber: business.phone || null,
            internationalPhoneNumber: null,
            utcOffset: null,
            settingsId: this.settings.id,
          })
          .onConflictDoNothing();

        savedCount++;
      } catch (error) {
        console.error(`Error saving business ${business.name}:`, error);
      }
    }

    return savedCount;
  }

  async destroy(): Promise<void> {
    if (this.cleanup) {
      await this.cleanup();
    }
  }
}
