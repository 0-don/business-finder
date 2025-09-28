## Dump

docker exec postgres pg_dump -U postgres -d business-finder -t grid_cell --data-only --column-inserts > grid_cell_inserts.sql

## Restore

docker exec -i postgres psql -U postgres -d business-finder < grid_cell_inserts.sql

docker exec -i postgres psql -U postgres -d business-finder < grid_cell_inserts.sql && clear && bun dev