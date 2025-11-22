import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { GridRepository } from "../lib/grid-repositroy";
import { Bounds, SettingsConfig } from "../types";
import { Geometry } from "./geometry";

dayjs.extend(relativeTime);

export class GridGenerator {
  private repo: GridRepository;
  private startTime = dayjs();
  private newCount = 0;

  constructor(private settings: SettingsConfig) {
    this.repo = new GridRepository(settings);
  }

  async generate(): Promise<number> {
    console.log(`Starting grid for ${this.settings.countryCode}`);
    const existingMin = await this.repo.getMinRadius();
    let radius = existingMin
      ? Math.floor(existingMin - 1)
      : this.settings.maxRadius;

    if (existingMin)
      console.log(`Resuming from ${radius}m (existing min: ${existingMin}m)`);

    const bounds = await this.repo.getBounds(this.settings.countryCode);
    let level = 0;

    while (radius >= this.settings.minRadius) {
      const candidates = Geometry.generateHexGrid(bounds, radius);
      const valid = await this.repo.validatePoints(
        candidates,
        radius,
        this.settings.countryCode
      );
      await this.repo.insertCells(
        valid.map((center) => ({ center, radius })),
        level
      );

      this.newCount += valid.length;
      console.log(
        `[${dayjs().format("HH:mm:ss")}] ${radius}m: ${valid.length} circles (total: ${await this.repo.getTotalCount()}) - ${dayjs().from(this.startTime)}`
      );

      level++;
      radius = (await this.findNextRadius(radius - 1, bounds)) ?? radius - 1;
    }

    return this.repo.getTotalCount();
  }

  async split(cellId: number): Promise<number> {
    const startTime = Date.now();
    const cell = await this.repo.getCell(cellId);
    if (!cell) return 0;

    console.log(`Splitting cell ${cellId} (${cell.radius}m, L${cell.level})`);
    const obstacles = await this.repo.getObstacles(
      { lng: cell.lng, lat: cell.lat },
      cell.radius * 3,
      cellId
    );
    const candidates = Geometry.generatePackCandidates(
      { lng: cell.lng, lat: cell.lat },
      cell.radius,
      this.settings.minRadius
    );
    const packed = Geometry.packCircles(candidates, obstacles);

    await this.repo.deleteCell(cellId);
    if (packed.length > 0) await this.repo.insertCells(packed, cell.level + 1);

    const duration = Date.now() - startTime;
    console.log(`Split complete: ${packed.length} new circles (${duration}ms)`);
    return packed.length;
  }

  private async findNextRadius(
    maxRadius: number,
    bounds: Bounds
  ): Promise<number | null> {
    const totalRange = maxRadius - this.settings.minRadius;

    for (let r = maxRadius - 1; r >= this.settings.minRadius; r--) {
      const tested = maxRadius - r;
      const progress = ((tested / totalRange) * 100).toFixed(1);

      if (process.env.DOCKER) {
        console.log(`Testing ${r}m (${progress}% - ${tested}/${totalRange})`);
      } else {
        process.stdout.write(
          `\r  Testing ${r}m (${progress}% - ${tested}/${totalRange})`
        );
      }

      const candidates = Geometry.generateHexGrid(bounds, r);
      const validCandidates = await this.repo.validatePoints(
        candidates,
        r,
        this.settings.countryCode
      );

      if (validCandidates.length > 0) {
        return r;
      }
    }

    return null;
  }
}
