import { GeoPackageAPI } from "@ngageoint/geopackage";
import { createReadStream, createWriteStream, existsSync } from "fs";
import { pipeline } from "stream/promises";
import { Extract } from "unzipper";

interface Country {
  name: string;
  iso_a3: string;
  geometry: {};
}

export async function extractGADMData() {
  const outputPath = "./src/data/gadm-countries.json";

  if (existsSync(outputPath)) {
    console.log("GADM data already extracted");
    return;
  }

  console.log("Downloading GADM data...");
  const response = await fetch(
    "https://geodata.ucdavis.edu/gadm/gadm4.1/gadm_410-gpkg.zip"
  );

  if (!response.body) throw new Error("Failed to download");

  await pipeline(response.body, createWriteStream("./gadm_410-gpkg.zip"));

  await pipeline(
    createReadStream("./gadm_410-gpkg.zip"),
    Extract({ path: "." })
  );

  console.log("Processing GeoPackage...");
  const geoPackage = await GeoPackageAPI.open("./gadm_410.gpkg");
  const featureTables = geoPackage.getFeatureTables();
  const countryTable = featureTables.find((t: string) => t.includes("ADM_0"));

  if (!countryTable) throw new Error("Country table not found");

  // Get the feature DAO to iterate through all features
  const featureDao = geoPackage.getFeatureDao(countryTable);
  const countries: Country[] = [];

  // Query all rows using the iterator
  const iterator = featureDao.queryForEach();
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
          // countries.push({
          //   name,
          //   iso_a3,
          //   geometry: geoJson,
          // });
        }
      }
    }
  }

  geoPackage.close();
}
