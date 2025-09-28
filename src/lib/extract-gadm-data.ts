import { GeoPackageAPI } from "@ngageoint/geopackage";
import cliProgress from "cli-progress";
import { eq, sql } from "drizzle-orm";
import { createReadStream, createWriteStream, existsSync, statSync } from "fs";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import { Extract } from "unzipper";
import { db } from "../db";
import { countries, gadmSubdivisions } from "../db/schema";
import { CountryCode, SettingsConfig, Subdivision } from "../types";
import { ZIP_PATH, DOWNLOAD_URL, GPKG_PATH } from "./constants";

const BATCH_SIZE = 100;

async function checkExistingData(isoA3?: CountryCode): Promise<boolean> {
  if (isoA3) {
    const existingCountry = await db
      .select()
      .from(countries)
      .where(eq(countries.isoA3, isoA3))
      .limit(1);
    return existingCountry.length > 0;
  }

  const existingCountries = await db.select().from(countries).limit(1);
  return existingCountries.length > 0;
}

async function downloadGADMZip(): Promise<void> {
  if (existsSync(ZIP_PATH)) return;

  console.log("Downloading GADM data...");
  const response = await fetch(DOWNLOAD_URL);
  if (!response.body) throw new Error("Download failed");

  const totalSize = parseInt(response.headers.get("content-length") || "0");
  let downloadedSize = 0;

  const downloadBar = new cliProgress.SingleBar(
    {
      format: "Downloading: {bar} {percentage}% | {value}/{total} MB",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
    },
    cliProgress.Presets.shades_classic
  );

  const totalMB = Math.round(totalSize / 1024 / 1024);
  downloadBar.start(totalMB, 0);

  const progressTransform = new Transform({
    transform(chunk, _, callback) {
      downloadedSize += chunk.length;
      const downloadedMB = Math.round(downloadedSize / 1024 / 1024);
      downloadBar.update(downloadedMB);
      callback(null, chunk);
    },
  });

  await pipeline(response.body, progressTransform, createWriteStream(ZIP_PATH));
  downloadBar.stop();
}

async function extractGADMZip(): Promise<void> {
  if (existsSync(GPKG_PATH)) return;

  console.log("Extracting GADM data...");
  const zipSize = statSync(ZIP_PATH).size;
  let extractedSize = 0;

  const extractBar = new cliProgress.SingleBar(
    {
      format: "Extracting: {bar} {percentage}% | {value}/{total} MB",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
    },
    cliProgress.Presets.shades_classic
  );

  const totalMB = Math.round(zipSize / 1024 / 1024);
  extractBar.start(totalMB, 0);

  const extractTransform = new Transform({
    transform(chunk, _, callback) {
      extractedSize += chunk.length;
      const extractedMB = Math.round(extractedSize / 1024 / 1024);
      extractBar.update(extractedMB);
      callback(null, chunk);
    },
  });

  await pipeline(
    createReadStream(ZIP_PATH),
    extractTransform,
    Extract({ path: "." })
  );
  extractBar.stop();
}

async function seedSubdivisions(isoA3?: CountryCode): Promise<void> {
  const message = isoA3
    ? `Seeding Subdivisions for ${isoA3} from GPKG...`
    : "Seeding Subdivisions from GPKG...";
  console.log(message);

  const geoPackage = await GeoPackageAPI.open(GPKG_PATH);
  const featureDao = geoPackage.getFeatureDao("gadm_410");

  const resultSet = isoA3
    ? featureDao.queryForAllEq("GID_0", isoA3)
    : featureDao.queryForAll();

  const totalRecords = isoA3 ? resultSet.length : featureDao.count();
  const batchSize = Math.ceil(totalRecords / BATCH_SIZE);

  let subdivisions: Subdivision[] = [];
  let processedRecords = 0;

  const subdivisionsBar = new cliProgress.SingleBar(
    {
      format: "Seeding Subdivisions: {bar} {percentage}% | {value}/{total}",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
    },
    cliProgress.Presets.shades_classic
  );

  subdivisionsBar.start(totalRecords, 0);

  for (const row of resultSet) {
    const feature = featureDao.getRow(row);
    const { geometry, values } = feature;

    if (!geometry?.geometry || !values?.GID_0) {
      processedRecords++;
      subdivisionsBar.update(processedRecords);
      continue;
    }

    subdivisions.push({
      uid: Number(values.UID),
      countryName: (values.COUNTRY || values.NAME_0)!.toString().trim(),
      isoA3: values.GID_0.toString() as CountryCode,
      geometry: sql`ST_GeomFromText(${geometry.geometry.toWkt()}, 4326)`,
    });

    processedRecords++;

    if (subdivisions.length >= batchSize) {
      await db
        .insert(gadmSubdivisions)
        .values(subdivisions)
        .onConflictDoNothing();
      subdivisionsBar.update(processedRecords);
      subdivisions = [];
    }
  }

  if (subdivisions.length > 0) {
    await db
      .insert(gadmSubdivisions)
      .values(subdivisions)
      .onConflictDoNothing();
    subdivisionsBar.update(processedRecords);
  }

  subdivisionsBar.stop();
  if (isoA3) {
    console.log(`Processed ${processedRecords} subdivisions for ${isoA3}`);
  }
  geoPackage.close();
}

async function createCountriesFromSubdivisions(
  isoA3?: CountryCode
): Promise<void> {
  const message = isoA3
    ? `Creating country ${isoA3} from subdivisions...`
    : "Creating countries from subdivisions...";
  console.log(message);

  const distinctCountriesQuery = db
    .selectDistinct({
      iso_a3: gadmSubdivisions.isoA3,
      country_name: gadmSubdivisions.countryName,
    })
    .from(gadmSubdivisions);

  const distinctCountries = isoA3
    ? await distinctCountriesQuery.where(eq(gadmSubdivisions.isoA3, isoA3))
    : await distinctCountriesQuery;

  const countriesBar = new cliProgress.SingleBar(
    {
      format:
        "Seeding Countries: {bar} {percentage}% | {value}/{total} | {country}",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
    },
    cliProgress.Presets.shades_classic
  );

  countriesBar.start(distinctCountries.length, 0, { country: "" });

  for (let i = 0; i < distinctCountries.length; i++) {
    const country = distinctCountries[i]!;

    await db
      .insert(countries)
      .values({
        name: country.country_name,
        isoA3: country.iso_a3,
        // Use ST_Union without ST_Multi since geometry type is now generic
        geometry: sql`(
          SELECT ST_Union(geometry)
          FROM gadm_subdivisions 
          WHERE "isoA3" = ${country.iso_a3}
        )`,
      })
      .onConflictDoNothing();

    countriesBar.update(i + 1, { country: country.country_name });
  }

  countriesBar.stop();
}

export async function extractGADMData(settings: SettingsConfig): Promise<void> {
  if (await checkExistingData(settings.countryCode)) return;

  await downloadGADMZip();
  await extractGADMZip();
  await seedSubdivisions(settings.countryCode);
  await createCountriesFromSubdivisions(settings.countryCode);
}
