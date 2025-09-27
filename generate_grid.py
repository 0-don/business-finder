import os
import math
import psycopg2
import numpy as np
from shapely.geometry import Point
from shapely import wkt
from typing import List, Tuple, Optional
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


@dataclass
class GridConfig:
    country_code: str
    max_radius: int = 50000
    min_radius: int = 100
    batch_size: int = 1000


class GeometryManager:
    def __init__(self, country_code: str):
        self.country_code = country_code
        self.conn = psycopg2.connect(os.getenv("DATABASE_URL"))
        self._boundary = None

    @property
    def boundary(self):
        if self._boundary is None:
            with self.conn.cursor() as cur:
                cur.execute(
                    "SELECT ST_AsText(geometry) FROM countries WHERE iso_a3 = %s",
                    (self.country_code,),
                )
                result = cur.fetchone()
                if not result:
                    raise ValueError(f"Country {self.country_code} not found")
                self._boundary = wkt.loads(result[0])
        return self._boundary

    def get_bounds(self) -> Tuple[float, float, float, float]:
        return self.boundary.bounds

    def contains_circle(self, x: float, y: float, radius_deg: float) -> bool:
        circle = Point(x, y).buffer(radius_deg)
        return self.boundary.contains(circle)

    @staticmethod
    def meters_to_degrees(meters: float, lat: float) -> float:
        return meters / (111320 * math.cos(math.radians(lat)))


class DatabaseManager:
    def __init__(self, connection, country_code: str):
        self.conn = connection
        self.country_code = country_code

    def clear_grid(self):
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM grid_cell")
            self.conn.commit()

    def find_largest_gap(self, min_radius: int, max_radius: int) -> Optional[int]:
        """Find the largest radius that can fit in uncovered areas using native PostGIS"""
        with self.conn.cursor() as cur:
            cur.execute(
                """
                WITH country_geom AS (
                    SELECT geometry FROM countries WHERE iso_a3 = %s
                ),
                sample_points AS (
                    SELECT (ST_DumpPoints(ST_GeneratePoints(geometry, 1000))).geom as point
                    FROM country_geom
                ),
                uncovered_points AS (
                    SELECT point
                    FROM sample_points sp
                    WHERE NOT EXISTS (
                        SELECT 1 FROM grid_cell gc
                        WHERE ST_DWithin(sp.point::geography, gc.center::geography, gc.radius_meters)
                    )
                ),
                gap_distances AS (
                    SELECT 
                        COALESCE(
                            MIN(ST_Distance(up.point::geography, gc.center::geography) - gc.radius_meters),
                            %s
                        ) as distance_to_nearest
                    FROM uncovered_points up
                    LEFT JOIN grid_cell gc ON true
                    GROUP BY up.point
                )
                SELECT MAX(distance_to_nearest) as max_gap 
                FROM gap_distances
                WHERE distance_to_nearest > %s
            """,
                (self.country_code, max_radius, min_radius),
            )

            result = cur.fetchone()
            if result and result[0] and result[0] > min_radius:
                return int(result[0] * 0.8)  # Use 80% of gap for safety
            return None

    def check_conflicts_batch(
        self, points: List[Tuple[float, float]], radius: float
    ) -> List[bool]:
        if not points:
            return []

        with self.conn.cursor() as cur:
            # Create array of points for batch processing
            point_strings = [f"POINT({lng} {lat})" for lng, lat in points]

            cur.execute(
                """
                WITH candidate_points AS (
                    SELECT unnest(%s::text[]) as wkt_point
                ),
                points_geom AS (
                    SELECT ST_GeomFromText(wkt_point, 4326) as point
                    FROM candidate_points
                )
                SELECT point,
                       NOT EXISTS(
                           SELECT 1 FROM grid_cell gc
                           WHERE ST_DWithin(
                               point::geography,
                               gc.center::geography,
                               %s + gc.radius_meters
                           )
                       ) as is_valid
                FROM points_geom
                ORDER BY ST_X(point), ST_Y(point)
            """,
                (point_strings, radius),
            )

            return [row[1] for row in cur.fetchall()]

    def insert_circles_batch(
        self, circles: List[Tuple[float, float]], radius: float, level: int
    ):
        if not circles:
            return

        with self.conn.cursor() as cur:
            values = []
            for lng, lat in circles:
                values.append((lng, lat, radius, radius, lng, lat, radius, level))

            cur.executemany(
                """
                INSERT INTO grid_cell (center, radius_meters, circle, level)
                VALUES (
                    ST_Point(%s, %s, 4326),
                    %s,
                    ST_Buffer(ST_Point(%s, %s, 4326)::geography, %s)::geometry,
                    %s
                )
            """,
                values,
            )
            self.conn.commit()


class OptimalGridGenerator:
    def __init__(self, config: GridConfig):
        self.config = config
        self.geometry = GeometryManager(config.country_code)
        self.db = DatabaseManager(self.geometry.conn, config.country_code)

    def clear_grid(self):
        print("Clearing existing grid...")
        self.db.clear_grid()
        print("Grid cleared")

    def generate_hex_points(
        self, bounds: Tuple[float, float, float, float], radius_deg: float
    ) -> List[Tuple[float, float]]:
        """Generate hexagonal grid points for optimal packing"""
        minx, miny, maxx, maxy = bounds
        dx = radius_deg * 2
        dy = radius_deg * math.sqrt(3)

        points = []
        y = miny + radius_deg
        row = 0

        while y <= maxy - radius_deg:
            x_start = minx + radius_deg
            if row % 2 == 1:  # Offset every other row for hexagonal packing
                x_start += dx / 2

            x = x_start
            while x <= maxx - radius_deg:
                points.append((x, y))
                x += dx
            y += dy
            row += 1

        return points

    def generate_level(self, radius: int, level: int) -> int:
        """Generate circles for a specific radius level"""
        print(f"  Processing level {level} (radius: {radius}m)")

        bounds = self.geometry.get_bounds()
        avg_lat = (bounds[1] + bounds[3]) / 2
        radius_deg = self.geometry.meters_to_degrees(radius, avg_lat)

        # Generate candidate points using hexagonal packing
        candidates = self.generate_hex_points(bounds, radius_deg)

        # Filter points that fit entirely within country
        valid_candidates = [
            (x, y)
            for x, y in candidates
            if self.geometry.contains_circle(x, y, radius_deg)
        ]

        if not valid_candidates:
            return 0

        # Process in batches to check conflicts and insert
        total_placed = 0
        for i in range(0, len(valid_candidates), self.config.batch_size):
            batch = valid_candidates[i : i + self.config.batch_size]
            conflict_results = self.db.check_conflicts_batch(batch, radius)

            valid_batch = [
                point for point, is_valid in zip(batch, conflict_results) if is_valid
            ]

            if valid_batch:
                self.db.insert_circles_batch(valid_batch, radius, level)
                total_placed += len(valid_batch)
                print(
                    f"    Batch {i//self.config.batch_size + 1}: {len(valid_batch)} circles"
                )

        return total_placed

    def calculate_initial_radius(self) -> int:
        """Calculate optimal starting radius based on country size"""
        bounds = self.geometry.get_bounds()
        width_deg = bounds[2] - bounds[0]
        height_deg = bounds[3] - bounds[1]
        avg_lat = (bounds[1] + bounds[3]) / 2

        # Convert to meters
        width_m = width_deg * 111320 * math.cos(math.radians(avg_lat))
        height_m = height_deg * 111320

        # Use 1/4 of smaller dimension as max radius
        optimal_radius = min(int(min(width_m, height_m) / 4), self.config.max_radius)
        print(f"Calculated optimal starting radius: {optimal_radius}m")
        return optimal_radius

    def generate_complete_grid(self) -> int:
        """Generate complete grid with dynamic radius optimization"""
        print(f"Starting grid generation for {self.config.country_code}")

        current_radius = self.calculate_initial_radius()
        total_circles = 0
        level = 0
        consecutive_empty_levels = 0

        while current_radius >= self.config.min_radius and consecutive_empty_levels < 3:
            placed = self.generate_level(current_radius, level)
            total_circles += placed

            print(
                f"Level {level} (radius {current_radius}m): {placed} circles (total: {total_circles})"
            )

            if placed == 0:
                consecutive_empty_levels += 1
                # More aggressive reduction when no circles placed
                current_radius = max(self.config.min_radius, current_radius // 2)
            else:
                consecutive_empty_levels = 0
                # Try to find optimal next radius based on gaps
                next_radius = self.db.find_largest_gap(
                    self.config.min_radius, current_radius - 50
                )

                if next_radius and next_radius < current_radius:
                    current_radius = next_radius
                    print(f"  Found gap-based radius: {current_radius}m")
                else:
                    # Fallback: reduce by fixed amount
                    current_radius = max(self.config.min_radius, current_radius - 200)

            level += 1

            # Safety check
            if level > 200:
                print("Maximum levels reached")
                break

        print(f"\nGrid generation complete!")
        print(f"Total circles: {total_circles}")
        print(f"Levels processed: {level}")
        return total_circles

    def get_statistics(self) -> dict:
        """Get grid statistics"""
        with self.db.conn.cursor() as cur:
            cur.execute(
                """
                SELECT 
                    level,
                    radius_meters,
                    COUNT(*) as count,
                    MIN(radius_meters) as min_radius,
                    MAX(radius_meters) as max_radius
                FROM grid_cell 
                GROUP BY level, radius_meters 
                ORDER BY level
            """
            )

            levels = cur.fetchall()

            cur.execute("SELECT COUNT(*) FROM grid_cell")
            total = cur.fetchone()[0]

            return {
                "total_circles": total,
                "levels": [
                    {
                        "level": row[0],
                        "radius": row[1],
                        "count": row[2],
                        "min_radius": row[3],
                        "max_radius": row[4],
                    }
                    for row in levels
                ],
            }

    def close(self):
        self.geometry.conn.close()


def main():
    import sys

    if len(sys.argv) < 2:
        print("Usage: python generate_grid.py <country_code> [max_radius] [min_radius]")
        sys.exit(1)

    config = GridConfig(
        country_code=sys.argv[1],
        max_radius=int(sys.argv[2]) if len(sys.argv) > 2 else 50000,
        min_radius=int(sys.argv[3]) if len(sys.argv) > 3 else 100,
    )

    generator = OptimalGridGenerator(config)
    generator.clear_grid()

    try:
        total = generator.generate_complete_grid()

        # Print statistics
        stats = generator.get_statistics()
        print(f"\nFinal Statistics:")
        print(f"Total circles: {stats['total_circles']}")
        print(f"Levels: {len(stats['levels'])}")
        for level_stat in stats["levels"]:
            print(
                f"  Level {level_stat['level']}: {level_stat['count']} circles at {level_stat['radius']}m"
            )

        print(f"\nSuccess: Generated {total} circles for {config.country_code}")

    except Exception as e:
        print(f"Error: {e}")
        import traceback

        traceback.print_exc()
    finally:
        generator.close()


if __name__ == "__main__":
    main()
