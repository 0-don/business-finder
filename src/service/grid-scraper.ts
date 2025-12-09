import { PuppeteerBlocker } from "@ghostery/adblocker-puppeteer";
import { execSync } from "child_process";
import { error, log } from "console";
import dayjs from "dayjs";
import { sql } from "drizzle-orm";
import { Page } from "puppeteer";
import { connect, PageWithCursor } from "puppeteer-real-browser";
import { db } from "../db";
import { businessSchema } from "../db/schema";
import { END_OF_SCROLL } from "../lib/constants";
import {
  canProceedWithScraping,
  extractBusinessDetails,
  gracefulShutdown,
  ipCheck,
  isRunningInDocker,
  restartContainer,
  setupCleanup,
  startStream,
} from "../lib/scrape";
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

type CellData = NonNullable<Awaited<ReturnType<GridRepository["getCell"]>>>;

export class GridScraper {
  private repo: GridRepository;
  private page: PageWithCursor | undefined;
  private cleanup: (() => Promise<void>) | undefined;
  private errorCount: number = 0;

  constructor(private settings: SettingsConfig) {
    this.repo = new GridRepository(settings);
  }

  async initialize(): Promise<void> {
    try {
      if (isRunningInDocker()) {
        execSync("rm -rf /tmp/lighthouse.* /tmp/puppeteer* 2>/dev/null", {
          timeout: 60000,
        });
        log("Cleaned up temp folders on startup");
      }
    } catch {}

    const { page, browser } = await connect({
      headless: false,
      turnstile: true,
      disableXvfb: process.env.DOCKER ? false : true,
    });
    await page.setViewport({ width: 970, height: 900 });
    await ipCheck(page as PageWithCursor);
    this.page = page;
    this.cleanup = await setupCleanup(browser, page);
    await startStream(page);

    try {
      const blocker = await PuppeteerBlocker.fromPrebuiltAdsAndTracking(fetch);
      await blocker.enableBlockingInPage(page as unknown as Page);
    } catch (err) {
      error("Failed to initialize adblocker:", err);
      await restartContainer();
      await gracefulShutdown();
    }
  }

  async processNextCell(): Promise<{
    cellId: number;
    businessCount: number;
    newBusinessCount: number;
  } | null> {
    this.errorCount = 0;

    const cell = await this.repo.getNextUnprocessed();
    if (!cell) return null;

    const cellData = await this.repo.getCell(cell.id);
    if (!cellData) return null;

    log(
      `${dayjs().format("HH:mm:ss")} Processing cell ${cell.id} - ${cellData.lat.toFixed(3)},${cellData.lng.toFixed(3)} :${cellData.radius}m`,
    );

    const result = await this.scrapeCell(cellData);
    await this.repo.markProcessed(cell.id);

    log(
      `${dayjs().format("HH:mm:ss")} Cell ${cell.id} complete: ${result.found} businesses found, ${result.inserted} new businesses added`,
    );
    return {
      cellId: cell.id,
      businessCount: result.found,
      newBusinessCount: result.inserted,
    };
  }

  private async scrapeCell(
    cellData: CellData,
  ): Promise<{ found: number; inserted: number }> {
    const url = `https://www.google.com/maps/search/${encodeURIComponent(this.settings.placeType)}/@${cellData.lat},${cellData.lng},11z?hl=en`;

    while (true) {
      await this.page?.goto(url, { timeout: 15000 });

      try {
        return await this.scrollAndSave(cellData);
      } catch (err: unknown) {
        this.errorCount++;
        const message = err instanceof Error ? err.message : String(err);
        error(
          `Error processing cell ${cellData.id} (attempt ${this.errorCount}): ${message}`,
        );
        if (this.errorCount >= 3) {
          await this.restartVPN();
        }
      }
    }
  }

  private async scrollAndSave(
    cellData: CellData,
  ): Promise<{ found: number; inserted: number }> {
    const seenBusinessIds = new Set<string>();
    let isLoadingCount = 0;
    let totalInserted = 0;

    while (true) {
      if (!(await canProceedWithScraping(this.page!))) {
        throw new Error("Cannot proceed with scraping");
      }

      const businesses = await extractBusinessDetails(this.page!);
      const uniqueBusinesses = businesses.filter((business) => {
        if (seenBusinessIds.has(business.id)) return false;
        seenBusinessIds.add(business.id);
        return true;
      });

      if (uniqueBusinesses.length > 0) {
        const saveResult = await this.saveBusinesses(
          uniqueBusinesses,
          cellData,
        );
        totalInserted += saveResult.inserted;
      }

      const isAtEnd = await this.page!.evaluate((endOfScrollText) => {
        return document.body.textContent?.includes(endOfScrollText) ?? false;
      }, END_OF_SCROLL);

      if (isAtEnd) break;

      await this.page!.evaluate(() =>
        document.querySelector('[role="feed"]')?.scrollTo(0, 999999),
      );
      await new Promise((r) => setTimeout(r, 5000));

      const isLoading = await this.page?.evaluate(() =>
        Array.from(document.querySelectorAll("*")).some((el) => {
          const styles = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return (
            styles.animationName?.includes("container-rotate") &&
            styles.animationPlayState === "running" &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.top < window.innerHeight &&
            rect.bottom > 0
          );
        }),
      );

      if (isLoading) isLoadingCount += 1;
      if (isLoadingCount >= 3) throw new Error("Loading seems to be stuck");
    }

    return { found: seenBusinessIds.size, inserted: totalInserted };
  }

  private async saveBusinesses(
    businesses: BusinessDetails[],
    cellData: CellData,
  ): Promise<{ attempted: number; inserted: number }> {
    let insertedCount = 0;

    for (const business of businesses) {
      try {
        const result = await db
          .insert(businessSchema)
          .values({
            placeId: business.id,
            name: business.name,
            address: business.address || "",
            rating: business.reviewScore || null,
            userRatingsTotal: business.reviewCount || 0,
            location: sql`ST_Point(${cellData.lng}, ${cellData.lat}, 4326)`,
            types: business.businessType ? [business.businessType] : null,
            website: business.website || null,
            phoneNumber: business.phone || null,
            settingsId: this.settings.id,
          })
          .onConflictDoUpdate({
            target: businessSchema.placeId,
            set: {
              name: business.name,
              address: business.address || "",
              rating: business.reviewScore || null,
              userRatingsTotal: business.reviewCount || 0,
              location: sql`ST_Point(${cellData.lng}, ${cellData.lat}, 4326)`,
              types: sql`CASE 
              WHEN ${businessSchema.types} IS NULL THEN ${business.businessType ? [business.businessType] : null}::jsonb
              WHEN ${business.businessType} IS NULL THEN ${businessSchema.types}
              WHEN NOT ${businessSchema.types} ? ${business.businessType} 
                THEN ${businessSchema.types} || ${business.businessType}::text::jsonb
              ELSE ${businessSchema.types}
            END`,
              website: business.website || null,
              phoneNumber: business.phone || null,
              updatedAt: new Date(),
            },
          })
          .returning({ id: businessSchema.id });

        if (result.length > 0) {
          insertedCount++;
        }
      } catch (err) {
        error(`Error saving business ${business.name}:`, err);
      }
    }

    return { attempted: businesses.length, inserted: insertedCount };
  }

  async destroy(): Promise<void> {
    if (this.cleanup) {
      await this.cleanup();
    }
  }

  private async restartVPN(): Promise<void> {
    log("Restarting VPN container...");
    try {
      await restartContainer();
    } catch (err) {
      error("Failed to restart VPN container:", err);
    }
    await gracefulShutdown(1);
  }
}
