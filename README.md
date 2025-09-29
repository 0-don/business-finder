# Business Finder

A geospatial application that systematically discovers and catalogs businesses using Google Places API with adaptive grid-based search coverage.

## Overview

Business Finder uses an intelligent hexagonal grid system to comprehensively search geographic areas for businesses. It adaptively splits search cells when too many results are found, ensuring complete coverage while respecting API limits.

## Features

- **Adaptive Grid Search**: Automatically adjusts search radius based on business density
- **Complete Coverage**: Hexagonal grid pattern ensures no gaps in geographic coverage
- **Interactive Map**: Real-time visualization of search grid and discovered businesses
- **PostGIS Integration**: Advanced spatial queries for efficient data management
- **Resumable**: Can pause and resume searches without losing progress
- **Multi-country Support**: Works with any country using GADM boundary data


## Dump

docker exec postgres pg_dump -U postgres -d business-finder -t grid_cell --data-only --column-inserts > grid_cell_inserts.sql

## Restore

docker exec -i postgres psql -U postgres -d business-finder < grid_cell_inserts.sql

docker exec -i postgres psql -U postgres -d business-finder < grid_cell_inserts.sql && clear && bun dev