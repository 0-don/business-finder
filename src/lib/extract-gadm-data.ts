import { GeoPackageAPI } from "@ngageoint/geopackage";
import * as cliProgress from "cli-progress";
import { SQL, sql } from "drizzle-orm";
import { createReadStream, createWriteStream, existsSync, statSync } from "fs";
import { pipeline } from "stream/promises";
import { Transform } from "stream";
import { Extract } from "unzipper";
import { db } from "../db";
import { countries, gadmSubdivisions } from "../db/schema";

type Subdivision = {
  countryName: string;
  isoA3: string;
  geometry: SQL<unknown>;
};

const BATCH_SIZE = 100;

export async function extractGADMData() {
  const zipPath = "./gadm_410-gpkg.zip";
  const gpkgPath = "./gadm_410.gpkg";

  // Check if data exists
  const existingCountries = await db.select().from(countries).limit(1);
  if (existingCountries.length > 0) {
    console.log("GADM data already exists");
    return;
  }

  // Download if needed
  if (!existsSync(zipPath)) {
    console.log("Downloading GADM data...");
    const response = await fetch(
      "https://geodata.ucdavis.edu/gadm/gadm4.1/gadm_410-gpkg.zip"
    );
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
      transform(chunk, encoding, callback) {
        downloadedSize += chunk.length;
        const downloadedMB = Math.round(downloadedSize / 1024 / 1024);
        downloadBar.update(downloadedMB);
        callback(null, chunk);
      }
    });

    await pipeline(
      response.body,
      progressTransform,
      createWriteStream(zipPath)
    );

    downloadBar.stop();
  }

  // Extract if needed
  if (!existsSync(gpkgPath)) {
    console.log("Extracting GADM data...");
    
    const zipSize = statSync(zipPath).size;
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
      transform(chunk, encoding, callback) {
        extractedSize += chunk.length;
        const extractedMB = Math.round(extractedSize / 1024 / 1024);
        extractBar.update(extractedMB);
        callback(null, chunk);
      }
    });

    await pipeline(
      createReadStream(zipPath),
      extractTransform,
      Extract({ path: "." })
    );

    extractBar.stop();
  }

  const geoPackage = await GeoPackageAPI.open(gpkgPath);
  const featureDao = geoPackage.getFeatureDao("gadm_410");
  const totalRecords = featureDao.count();
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

  for (const row of featureDao.queryForEach()) {
    const feature = featureDao.getRow(row);
    const { geometry, values } = feature;

    if (!geometry?.geometry || !values?.GID_0) continue;

    subdivisions.push({
      countryName: (values.COUNTRY || values.NAME_0)!.toString().trim(),
      isoA3: values.GID_0.toString(),
      geometry: sql`ST_GeomFromText(${geometry.geometry.toWkt()}, 4326)`,
    });

    processedRecords++;

    if (subdivisions.length >= batchSize) {
      await db.insert(gadmSubdivisions).values(subdivisions);
      subdivisionsBar.update(processedRecords);
      subdivisions = [];
    }
  }

  if (subdivisions.length > 0) {
    await db.insert(gadmSubdivisions).values(subdivisions);
    subdivisionsBar.update(processedRecords);
  }

  subdivisionsBar.stop();
  geoPackage.close();

  // Create countries from subdivisions
  console.log("Creating countries from subdivisions...");
  const distinctCountries = await db
    .selectDistinct({
      iso_a3: gadmSubdivisions.isoA3,
      country_name: gadmSubdivisions.countryName,
    })
    .from(gadmSubdivisions);

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

    await db.execute(sql`
      INSERT INTO countries (name, iso_a3, geometry)
      SELECT ${country.country_name}, ${country.iso_a3}, ST_Multi(ST_Union(geometry))
      FROM gadm_subdivisions WHERE iso_a3 = ${country.iso_a3}
    `);

    countriesBar.update(i + 1, { country: country.country_name });
  }

  countriesBar.stop();
  console.log(`\nComplete: ${distinctCountries.length} countries created`);
}