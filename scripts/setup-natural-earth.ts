import { createReadStream, createWriteStream, existsSync } from "fs";
import { copyFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pipeline } from "stream/promises";
import { Extract } from "unzipper";

export const NATURAL_EARTH_VECTOR = "natural_earth_vector";

export async function setupNaturalEarth() {
  const dbPath = `./${NATURAL_EARTH_VECTOR}.sqlite`;

  if (existsSync(dbPath)) {
    console.log("Natural Earth database already exists");
    return `file:${dbPath}`;
  }

  const url = `https://naciscdn.org/naturalearth/packages/${NATURAL_EARTH_VECTOR}.sqlite.zip`;

  const tempDir = tmpdir();
  const zipPath = join(tempDir, `${NATURAL_EARTH_VECTOR}.sqlite.zip`);

  console.log("Downloading Natural Earth data...");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.statusText}`);
  }

  const fileStream = createWriteStream(zipPath);
  await pipeline(response.body!, fileStream);

  console.log("Extracting database...");

  const readStream = createReadStream(zipPath);
  await pipeline(readStream, Extract({ path: tempDir }));

  const extractedPath = join(
    tempDir,
    "packages",
    `${NATURAL_EARTH_VECTOR}.sqlite`
  );
  if (existsSync(extractedPath)) {
    await copyFile(extractedPath, dbPath);
    console.log("Natural Earth database ready!");
    return `file:${dbPath}`;
  } else {
    throw new Error("Extracted SQLite file not found in packages/");
  }
}

if (import.meta.main) {
  setupNaturalEarth().catch(console.error);
}
