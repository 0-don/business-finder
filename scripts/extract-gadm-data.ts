import { GeoPackageAPI } from "@ngageoint/geopackage";
import { createReadStream, createWriteStream, existsSync } from "fs";
import { mkdir } from "fs/promises";
import { dirname } from "path";
import { pipeline } from "stream/promises";
import { Extract } from "unzipper";

interface Country {
  name: string;
  iso_a3: string;
  geometry: {};
}

export async function extractGADMData() {
  const outputPath = "./gadm-countries.json";
  const zipPath = "./gadm_410-gpkg.zip";
  const gpkgPath = "./gadm_410.gpkg";

  if (existsSync(outputPath)) {
    console.log("GADM data already extracted");
    return;
  }

  // Check if we need to download
  if (!existsSync(zipPath)) {
    console.log("Downloading GADM data...");
    const response = await fetch(
      "https://geodata.ucdavis.edu/gadm/gadm4.1/gadm_410-gpkg.zip"
    );

    if (!response.body) throw new Error("Failed to download");

    await pipeline(response.body, createWriteStream(zipPath));
  } else {
    console.log("ZIP file already exists, skipping download");
  }

  // Check if we need to extract
  if (!existsSync(gpkgPath)) {
    console.log("Extracting GeoPackage...");
    await pipeline(createReadStream(zipPath), Extract({ path: "." }));
  } else {
    console.log("GeoPackage already exists, skipping extraction");
  }

  console.log("Processing GeoPackage...");
  const geoPackage = await GeoPackageAPI.open(gpkgPath);

  const featureTables = geoPackage.getFeatureTables();
  console.log("Feature tables found:", featureTables);
  const countryTable = featureTables.find((t: string) =>
    t.includes("gadm_410")
  );

  if (!countryTable) throw new Error("Country table not found");

  const featureDao = geoPackage.getFeatureDao(countryTable);

  // --- Start of the fix ---

  // Ensure the output directory exists before creating the stream
  await mkdir(dirname(outputPath), { recursive: true });

  // --- End of the fix ---

  const writeStream = createWriteStream(outputPath);

  writeStream.write("[");

  const iterator = featureDao.queryForEach();
  let isFirst = true;
  let countryCount = 0;

  for (const row of iterator) {
    const feature = featureDao.getRow(row);
    const geometry = feature.geometry;
    if (geometry) {
      const geom = geometry.geometry;
      const geoJson = geom.toGeoJSON();
      const props = feature.values;
      if (props) {
        const name = (props.COUNTRY || props.NAME_EN) as string;
        const iso_a3 = props.GID_0 as string;

        if (name && iso_a3) {
          const country: Country = {
            name,
            iso_a3,
            geometry: geoJson,
          };

          if (!isFirst) {
            writeStream.write(",");
          }

          writeStream.write(JSON.stringify(country));
          isFirst = false;
          countryCount++;
        }
      }
    }
  }

  writeStream.write("]");
  writeStream.end();

  geoPackage.close();

  console.log(`Extracted ${countryCount} countries to ${outputPath}`);
}

if (import.meta.main) {
  extractGADMData().catch(console.error);
}
