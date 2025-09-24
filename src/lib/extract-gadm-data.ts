import { GeoPackageAPI } from "@ngageoint/geopackage";
import { SQL, sql } from "drizzle-orm";
import { createReadStream, createWriteStream, existsSync } from "fs";
import { pipeline } from "stream/promises";
import { Extract } from "unzipper";
import { db } from "../db";
import { countries, gadmSubdivisions } from "../db/schema";

type Subdivision = {
  countryName: string;
  isoA3: string;
  geometry: SQL<unknown>;
};

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
    await pipeline(response.body, createWriteStream(zipPath));
  }

  // Extract if needed
  if (!existsSync(gpkgPath)) {
    console.log("Extracting GADM data...");
    await pipeline(createReadStream(zipPath), Extract({ path: "." }));
  }

  // Process GeoPackage
  console.log("Processing GeoPackage...");
  const geoPackage = await GeoPackageAPI.open(gpkgPath);
  const featureDao = geoPackage.getFeatureDao("gadm_410");
  const totalRecords = featureDao.count();
  const batchSize = Math.ceil(totalRecords / 100);

  let subdivisions: Subdivision[] = [];
  let processedRecords = 0;

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
      const percentage = Math.round((processedRecords / totalRecords) * 100);
      process.stdout.write(
        `\rSeeding Subdivisions: ${percentage}% (${processedRecords}/${totalRecords})`
      );
      subdivisions = [];
    }
  }

  if (subdivisions.length > 0) {
    await db.insert(gadmSubdivisions).values(subdivisions);
    process.stdout.write(
      `\rSeeding Subdivisions: 100% (${processedRecords}/${totalRecords})\n`
    );
  }

  geoPackage.close();

  // Create countries from subdivisions
  console.log("Creating countries from subdivisions...");
  const distinctCountries = await db
    .selectDistinct({
      iso_a3: gadmSubdivisions.isoA3,
      country_name: gadmSubdivisions.countryName,
    })
    .from(gadmSubdivisions);

  for (let i = 0; i < distinctCountries.length; i++) {
    const country = distinctCountries[i]!;

    await db.execute(sql`
      INSERT INTO countries (name, iso_a3, geometry)
      SELECT ${country.country_name}, ${country.iso_a3}, ST_Multi(ST_Union(geometry))
      FROM gadm_subdivisions WHERE iso_a3 = ${country.iso_a3}
    `);

    const percentage = Math.round(((i + 1) / distinctCountries.length) * 100);
    process.stdout.write(
      `\rSeeding Countries: ${percentage}% (${i + 1}/${distinctCountries.length}) - ${country.country_name}`
    );
  }

  console.log(`\n\nComplete: ${distinctCountries.length} countries created`);
}
