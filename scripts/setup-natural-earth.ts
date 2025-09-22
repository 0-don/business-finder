import { createReadStream, createWriteStream, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pipeline } from "stream/promises";
import { Extract } from "unzipper";

const NATURAL_EARTH_VECTOR = "natural_earth_vector";

export async function downloadNaturalEarthDB(): Promise<string> {
  const tempDir = tmpdir();
  const dbPath = join(tempDir, `${NATURAL_EARTH_VECTOR}.sqlite`);
  const zipPath = join(tempDir, `${NATURAL_EARTH_VECTOR}.sqlite.zip`);

  if (existsSync(dbPath)) return `file:${dbPath}`;

  console.log("Downloading Natural Earth data...");
  const url = `https://naciscdn.org/naturalearth/packages/${NATURAL_EARTH_VECTOR}.sqlite.zip`;
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.statusText}`);
  }

  await pipeline(response.body, createWriteStream(zipPath));
  console.log("Extracting database...");
  await pipeline(createReadStream(zipPath), Extract({ path: tempDir }));

  const extractedPath = join(
    tempDir,
    "packages",
    `${NATURAL_EARTH_VECTOR}.sqlite`
  );
  if (!existsSync(extractedPath))
    throw new Error("Extracted SQLite file not found.");

  return `file:${extractedPath}`;
}

if (import.meta.main) {
  downloadNaturalEarthDB().then(console.log);
}
