import { GeoPackageAPI } from "@ngageoint/geopackage";
import { sql } from "drizzle-orm";
import { createReadStream, createWriteStream, existsSync } from "fs";
import { pipeline } from "stream/promises";
import { Extract } from "unzipper";
import { db } from "../db";
import { countries, gadmSubdivisions } from "../db/schema";

export async function extractGADMData() {
  const zipPath = "./gadm_410-gpkg.zip";
  const gpkgPath = "./gadm_410.gpkg";

  // Check if data already exists in database
  const existingCountries = await db.select().from(countries).limit(1);
  if (existingCountries.length > 0) {
    console.log("GADM data already exists in database");
    return;
  }

  // Download if zip doesn't exist
  if (!existsSync(zipPath)) {
    console.log("Downloading GADM data...");
    const response = await fetch(
      "https://geodata.ucdavis.edu/gadm/gadm4.1/gadm_410-gpkg.zip"
    );

    if (!response.body) throw new Error("Failed to download");
    await pipeline(response.body, createWriteStream(zipPath));
  }

  // Extract if gpkg doesn't exist
  if (!existsSync(gpkgPath)) {
    console.log("Extracting GADM data...");
    await pipeline(createReadStream(zipPath), Extract({ path: "." }));
  }

  console.log("Clearing existing subdivision data...");
  await db.delete(gadmSubdivisions);

  console.log("Processing GeoPackage and bulk loading subdivisions...");
  const geoPackage = await GeoPackageAPI.open(gpkgPath);
  const featureDao = geoPackage.getFeatureDao("gadm_410");
  const resultSet = featureDao.queryForEach();

  const batchSize = 1000;
  let subdivisionsToInsert = [];

  for (const row of resultSet) {
    const feature = featureDao.getRow(row);
    const geometry = feature.geometry?.geometry;
    const props = feature.values;

    if (!geometry || !props) continue;

    const iso_a3 = props.GID_0 as string;
    const countryName = (props.COUNTRY || props.NAME_0) as string;

    if (!iso_a3 || !countryName) continue;

    subdivisionsToInsert.push({
      countryName: countryName.trim(),
      isoA3: iso_a3,
      geometry: sql`ST_GeomFromText(${geometry.toWkt()}, 4326)`,
    });

    // Batch insert for performance
    if (subdivisionsToInsert.length >= batchSize) {
      await db.insert(gadmSubdivisions).values(subdivisionsToInsert);
      console.log(
        `Inserted batch of ${subdivisionsToInsert.length} subdivisions...`
      );
      subdivisionsToInsert = [];
    }
  }

  // Insert remaining records
  if (subdivisionsToInsert.length > 0) {
    await db.insert(gadmSubdivisions).values(subdivisionsToInsert);
    console.log(
      `Inserted final batch of ${subdivisionsToInsert.length} subdivisions`
    );
  }

  console.log("Performing PostGIS union to create country boundaries...");

  // Use PostGIS to union all subdivisions by country
  const unionQuery = sql`
    INSERT INTO countries (name, iso_a3, geometry)
    SELECT
      country_name,
      iso_a3,
      ST_Multi(ST_Union(geometry)) as geometry
    FROM gadm_subdivisions
    GROUP BY iso_a3, country_name
  `;

  await db.execute(unionQuery);

  console.log("Cleaning up temporary subdivision data...");
  await db.delete(gadmSubdivisions);

  const countryCount = await db.select().from(countries);
  console.log(
    `Database seeding complete. Created ${countryCount.length} countries.`
  );
}
