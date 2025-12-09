# Business Finder

A web scraper that systematically discovers and collects business data from Google Maps using hexagonal grid-based geographic coverage.

## Features

- **Hexagonal Grid Coverage**: Generates non-overlapping hexagonal search cells for complete geographic coverage
- **Automated Web Scraping**: Uses Puppeteer with ad-blocking and browser fingerprint evasion
- **Resumable Progress**: Stores grid cells and scraping state in SQLite database
- **Country-Based Searching**: Uses GADM boundary data to limit searches to specific countries
- **Configurable**: Set search radius, country code, and place type via environment variables

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables (see [.env.example](.env.example)):
   - `DEFAULT_COUNTRY_CODE`: ISO 3166-1 alpha-3 country code (e.g., "DEU")
   - `DEFAULT_PLACE_TYPE`: Google Maps place type (e.g., "accounting")
   - `RADIUS`: Search radius in meters (default: 3500)

3. Run the scraper:
   ```bash
   npm run dev
   ```

## How It Works

1. Downloads GADM geographic boundary data for the specified country
2. Generates hexagonal grid cells covering the country bounds
3. Validates cells are within country boundaries
4. Systematically scrapes Google Maps for each grid cell
5. Stores results in SQLite database with GeoPackage support
