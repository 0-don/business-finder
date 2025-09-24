import { GeoPackageAPI } from "@ngageoint/geopackage";
import { sql } from "drizzle-orm";
import { createReadStream, createWriteStream, existsSync } from "fs";
import { pipeline } from "stream/promises";
import { Extract } from "unzipper";
import { db } from "../db";
import { countries } from "../db/schema";

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
  } else {
    console.log("Using existing GADM zip file");
  }

  // Extract if gpkg doesn't exist
  if (!existsSync(gpkgPath)) {
    console.log("Extracting GADM data...");
    await pipeline(createReadStream(zipPath), Extract({ path: "." }));
  } else {
    console.log("Using existing GADM GeoPackage");
  }

  console.log("Processing GeoPackage...");
  const geoPackage = await GeoPackageAPI.open(gpkgPath);
  const featureTables = geoPackage.getFeatureTables();

  console.log("Feature tables found:", featureTables);
  // Process countries (ADM_0)
  const countryTable = featureTables.find((t: string) =>
    t.includes("gadm_410")
  );
  if (!countryTable) throw new Error("Country table not found");

  console.log("Seeding countries...");
  const countryDao = geoPackage.getFeatureDao(countryTable);
  const countryIterator = countryDao.queryForEach();

  let insertedCount = 0;

  for (const row of countryIterator) {
    const feature = countryDao.getRow(row);
    const geometry = feature.geometry?.geometry;
    const props = feature.values;

    if (geometry && props) {
      const name = (props.COUNTRY || props.NAME_EN) as string;
      const iso_a3 = props.GID_0 as string;

      if (name && iso_a3) {
        try {
          await db
            .insert(countries)
            .values({
              name: name.trim(),
              isoA3: iso_a3,
              geometry: sql`ST_GeomFromText(${geometry.toWkt()}, 4326)`,
            })
            .onConflictDoNothing();

          insertedCount++;
          if (insertedCount % 100 === 0) {
            console.log(`Processed ${insertedCount} countries...`);
          }
        } catch (error) {
          console.error(`Failed to insert country ${name} (${iso_a3}):`, error);
        }
      }
    }
  }

  geoPackage.close();
  console.log(
    `GADM data processing complete. Inserted ${insertedCount} countries.`
  );
}
