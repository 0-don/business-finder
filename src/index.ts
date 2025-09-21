import {
  Client,
  Language,
  PlaceType1,
} from "@googlemaps/google-maps-services-js";
import { GERMANY_POPULATION_GRID, type GridCell } from "./lib/germany-grid";
import {
  exponentialBackoff,
  getSearchState,
  updateSearchState,
} from "./lib/utils";

const client = new Client();

async function searchRegion(
  gridCell: GridCell,
  regionIndex: number,
  startPageIndex = 0,
  startPageToken?: string | null
) {
  let totalResults = 0;
  let nextPageToken: string | undefined = startPageToken || undefined;
  let pageCount = startPageIndex;

  const { lat, lng, radius, cellSize, populationDensity, nearestCity } =
    gridCell;

  console.log(
    `  Searching ${populationDensity} density area near ${nearestCity || "rural"}`
  );
  console.log(`  Cell: ${cellSize}km, Radius: ${radius / 1000}km`);

  do {
    console.log(`    Page ${pageCount + 1}`);

    const response = await exponentialBackoff(async () => {
      return client.placesNearby({
        params: {
          location: { lat, lng },
          radius, // Use the calculated radius for this cell
          type: PlaceType1.accounting,
          keyword:
            "tax|steuer|steuerberater|steuerkanzlei|steuerberatung|buchführung|lohnsteuer|wirtschaftsprüfer|finanzbuchhaltung|jahresabschluss|steuererklärung",
          language: Language.de,
          key: process.env.GOOGLE_MAPS_API_KEY,
          ...(nextPageToken && { pagetoken: nextPageToken }),
        },
      });
    });

    // Rest of your existing logic...
    const pageResults = response.data.results.length;
    totalResults += pageResults;
    console.log(`      ${pageResults} results`);

    // Process results (your existing code)...

    nextPageToken = response.data.next_page_token;
    pageCount++;

    await updateSearchState(regionIndex, pageCount, nextPageToken);
  } while (nextPageToken && pageCount < 3);

  return totalResults;
}

async function main() {
  console.log("Starting population-based business search...");
  console.log(`Total regions to search: ${GERMANY_POPULATION_GRID.length}`);

  const state = await getSearchState();

  for (let i = state.regionIndex; i < GERMANY_POPULATION_GRID.length; i++) {
    const gridCell = GERMANY_POPULATION_GRID[i]!;

    console.log(`\nRegion ${i + 1}/${GERMANY_POPULATION_GRID.length}:`);
    console.log(`  Location: (${gridCell.lat}, ${gridCell.lng})`);
    console.log(
      `  Type: ${gridCell.populationDensity} density (${gridCell.cellSize}km cells)`
    );

    const startPageIndex = i === state.regionIndex ? state.pageIndex : 0;
    const startPageToken =
      i === state.regionIndex ? state.nextPageToken : undefined;

    await searchRegion(
      gridCell,
      i,
      startPageIndex,
      startPageToken || undefined
    );
    await updateSearchState(i + 1, 0, null);
  }

  console.log("\n🎉 Population-based search completed!");
}

main();
