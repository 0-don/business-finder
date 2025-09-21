import { createReadStream, createWriteStream, existsSync } from "fs";
import { rename, rm } from "fs/promises";
import { pipeline } from "stream/promises";
import { Extract } from "unzipper";

export async function setupNaturalEarth() {
  const dbPath = "./natural_earth_vector.sqlite";

  if (existsSync(dbPath)) {
    console.log("Natural Earth database already exists");
    return;
  }

  const url =
    "https://naciscdn.org/naturalearth/packages/natural_earth_vector.sqlite.zip";
  const zipPath = "./natural_earth_vector.sqlite.zip";

  console.log("Downloading Natural Earth data...");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.statusText}`);
  }

  const fileStream = createWriteStream(zipPath);
  await pipeline(response.body!, fileStream);

  console.log("Extracting database...");

  const readStream = createReadStream(zipPath);
  await pipeline(readStream, Extract({ path: "." }));

  const extractedPath = "./packages/natural_earth_vector.sqlite";
  if (existsSync(extractedPath)) {
    await rename(extractedPath, dbPath);
    console.log("Natural Earth database ready!");
  } else {
    throw new Error("Extracted SQLite file not found in packages/");
  }

  await rm(zipPath, { force: true });
  await rm("packages", { recursive: true, force: true });
}

if (import.meta.main) {
  setupNaturalEarth().catch(console.error);
}
