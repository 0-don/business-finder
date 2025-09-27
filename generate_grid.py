import os
import psycopg2
import numpy as np
from scipy.spatial.distance import cdist
from shapely.geometry import Point, Polygon
from shapely.ops import transform
from shapely import wkt
import geopandas as gpd
from typing import List, Tuple, Optional
import json
import sys
from dotenv import load_dotenv

load_dotenv()


class OptimalCirclePackingGrid:
    def __init__(self, country_code: str):
        self.country_code = country_code
        self.conn = psycopg2.connect(os.getenv("DATABASE_URL"))
        self.country_boundary = self._get_country_boundary()

    def _get_country_boundary(self):
        """Get country boundary from PostGIS"""
        with self.conn.cursor() as cur:
            cur.execute(
                """
                SELECT ST_AsText(geometry) 
                FROM countries 
                WHERE iso_a3 = %s
            """,
                (self.country_code,),
            )
            result = cur.fetchone()
            if not result:
                raise ValueError(f"Country {self.country_code} not found")
            return wkt.loads(result[0])

    def _clear_existing_grid(self):
        """Clear existing grid cells"""
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM grid_cell")
            self.conn.commit()
        print("Cleared existing grid")

    def _get_country_bounds(self) -> Tuple[float, float, float, float]:
        """Get bounding box of country"""
        bounds = self.country_boundary.bounds
        return bounds

    def _meters_to_degrees(self, meters: float, lat: float) -> float:
        """Convert meters to degrees at given latitude"""
        earth_radius = 6378137.0
        deg_per_meter = 1.0 / (earth_radius * np.pi / 180.0)
        lat_correction = np.cos(np.radians(lat))
        return meters * deg_per_meter / lat_correction

    def _point_in_country(self, x: float, y: float) -> bool:
        """Check if point is within country boundary"""
        point = Point(x, y)
        return self.country_boundary.contains(point)

    def _circle_conflicts_with_existing(
        self, x: float, y: float, radius_meters: int
    ) -> bool:
        """Check if circle conflicts with existing circles in database"""
        with self.conn.cursor() as cur:
            cur.execute(
                """
                SELECT EXISTS(
                    SELECT 1 FROM grid_cell g
                    WHERE ST_DWithin(
                        ST_Point(%s, %s, 4326)::geography,
                        ST_Centroid(g.circle_geometry)::geography,
                        %s + g.radius
                    )
                )
            """,
                (x, y, radius_meters),
            )
            return cur.fetchone()[0]

    def _find_largest_possible_radius(
        self, min_radius: int = 100, max_radius: int = 50000
    ) -> Optional[int]:
        """Binary search to find the largest radius that can place at least one circle"""
        print(
            f"Finding largest possible radius between {min_radius}m and {max_radius}m..."
        )

        left, right = min_radius, max_radius
        best_radius = None

        while left <= right:
            mid = (left + right) // 2

            # Test if we can place at least one circle with this radius
            test_circles = self._pack_circles_systematic(mid, max_circles=1)

            if test_circles:
                print(f"  ✓ {mid}m: possible")
                best_radius = mid
                left = mid + 1  # Try larger
            else:
                print(f"  ✗ {mid}m: too large")
                right = mid - 1  # Try smaller

        if best_radius:
            print(f"Largest possible radius: {best_radius}m")
        else:
            print("No valid radius found in range")

        return best_radius

    def _pack_circles_systematic(
        self, radius_meters: int, max_circles: Optional[int] = None
    ) -> List[Tuple[float, float]]:
        """Pack circles systematically with grid sampling + random fill"""
        minx, miny, maxx, maxy = self._get_country_bounds()

        center_lat = (miny + maxy) / 2
        radius_deg = self._meters_to_degrees(radius_meters, center_lat)

        # Grid spacing slightly less than optimal for better packing
        grid_spacing = radius_deg * 1.8

        x_points = np.arange(minx + radius_deg, maxx - radius_deg, grid_spacing)
        y_points = np.arange(miny + radius_deg, maxy - radius_deg, grid_spacing)

        circles = []

        # Systematic grid sampling
        for i, x in enumerate(x_points):
            if max_circles and len(circles) >= max_circles:
                break

            for y in y_points:
                if max_circles and len(circles) >= max_circles:
                    break

                if self._can_place_circle(x, y, radius_meters, radius_deg, circles):
                    circles.append((x, y))

        # Random sampling to fill gaps (if not limited to max_circles)
        if not max_circles or len(circles) < max_circles:
            random_attempts = (
                5000 if not max_circles else min(100, max_circles - len(circles))
            )

            for _ in range(random_attempts):
                if max_circles and len(circles) >= max_circles:
                    break

                x = np.random.uniform(minx + radius_deg, maxx - radius_deg)
                y = np.random.uniform(miny + radius_deg, maxy - radius_deg)

                if self._can_place_circle(x, y, radius_meters, radius_deg, circles):
                    circles.append((x, y))

        return circles

    def _can_place_circle(
        self,
        x: float,
        y: float,
        radius_meters: int,
        radius_deg: float,
        existing_circles: List[Tuple[float, float]],
    ) -> bool:
        """Check if a circle can be placed at given position"""
        # Check if point is in country
        if not self._point_in_country(x, y):
            return False

        # Check if circle fits entirely within country
        circle = Point(x, y).buffer(radius_deg)
        if not self.country_boundary.contains(circle):
            return False

        # Check conflicts with existing database circles
        if self._circle_conflicts_with_existing(x, y, radius_meters):
            return False

        # Check conflicts with circles in current batch
        if existing_circles:
            existing_points = np.array(existing_circles)
            distances = cdist([[x, y]], existing_points)[0]
            min_distance = 2 * radius_deg

            if np.any(distances < min_distance):
                return False

        return True

    def _get_uncovered_sample_points(
        self, radius_meters: int
    ) -> List[Tuple[float, float]]:
        """Get sample points in uncovered areas"""
        minx, miny, maxx, maxy = self._get_country_bounds()

        # Sample resolution based on radius
        sample_resolution = self._meters_to_degrees(
            radius_meters * 0.5, (miny + maxy) / 2
        )

        x_points = np.arange(minx, maxx, sample_resolution)
        y_points = np.arange(miny, maxy, sample_resolution)

        uncovered_points = []

        print(f"Sampling for uncovered areas (resolution: {sample_resolution:.6f}°)...")

        for i, x in enumerate(x_points):
            if i % max(1, len(x_points) // 20) == 0:
                print(f"  Progress: {i/len(x_points)*100:.1f}%")

            for y in y_points:
                if not self._point_in_country(x, y):
                    continue

                # Check if point is covered by existing circles
                with self.conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT EXISTS(
                            SELECT 1 FROM grid_cell g
                            WHERE ST_DWithin(
                                ST_Point(%s, %s, 4326)::geography,
                                ST_Centroid(g.circle_geometry)::geography,
                                g.radius
                            )
                        )
                    """,
                        (x, y),
                    )

                    is_covered = cur.fetchone()[0]
                    if not is_covered:
                        uncovered_points.append((x, y))

        print(f"Found {len(uncovered_points)} uncovered sample points")
        return uncovered_points

    def _insert_circles(
        self, circles: List[Tuple[float, float]], radius_meters: int, level: int
    ):
        """Insert circles into database"""
        if not circles:
            return

        print(f"Inserting {len(circles)} circles into database...")

        with self.conn.cursor() as cur:
            for i, (x, y) in enumerate(circles):
                cur.execute(
                    """
                    INSERT INTO grid_cell 
                    (latitude, longitude, radius, circle_geometry, level)
                    VALUES (%s, %s, %s, 
                            ST_Buffer(ST_Point(%s, %s, 4326)::geography, %s)::geometry,
                            %s)
                """,
                    (y, x, radius_meters, x, y, radius_meters, level),
                )

                if (i + 1) % 100 == 0:
                    print(f"  Inserted {i + 1}/{len(circles)} circles")

            self.conn.commit()
        print(f"Successfully inserted {len(circles)} circles")

    def generate_optimal_coverage_grid(
        self, start_radius: int = 50000, min_radius: int = 100
    ):
        """Generate complete coverage with automatically detected optimal radii"""
        self._clear_existing_grid()

        level = 0
        total_circles = 0
        current_max_radius = start_radius

        print(
            f"Generating optimal coverage grid: starting at {start_radius}m, minimum {min_radius}m"
        )

        while current_max_radius >= min_radius:
            print(f"\n--- Level {level} ---")

            # Find the largest possible radius for this level
            optimal_radius = self._find_largest_possible_radius(
                min_radius=min_radius, max_radius=current_max_radius
            )

            if not optimal_radius:
                print("No more circles can be placed")
                break

            print(f"Packing circles with radius {optimal_radius}m...")

            if level == 0:
                # First level: full systematic packing
                circles = self._pack_circles_systematic(optimal_radius)
            else:
                # Check for uncovered areas and focus there
                uncovered_points = self._get_uncovered_sample_points(optimal_radius)

                if uncovered_points:
                    # Focus on uncovered areas
                    circles = []
                    center_lat = (
                        self.country_boundary.bounds[1]
                        + self.country_boundary.bounds[3]
                    ) / 2
                    radius_deg = self._meters_to_degrees(optimal_radius, center_lat)

                    for x, y in uncovered_points:
                        if self._can_place_circle(
                            x, y, optimal_radius, radius_deg, circles
                        ):
                            circles.append((x, y))

                            # Don't check every single point if we have many
                            if len(circles) > 1000:
                                break
                else:
                    # No specific uncovered points, try systematic approach
                    circles = self._pack_circles_systematic(optimal_radius)

            if circles:
                self._insert_circles(circles, optimal_radius, level)
                total_circles += len(circles)
                print(
                    f"Level {level} complete: {len(circles)} circles (total: {total_circles})"
                )

                # Set next max radius to be smaller than current
                current_max_radius = optimal_radius - 1
            else:
                print(f"No circles could be placed at radius {optimal_radius}m")
                # Reduce max radius more aggressively
                current_max_radius = optimal_radius // 2

            level += 1

            # Safety limit
            if level > 50:
                print("Maximum levels reached")
                break

        print(f"\nOptimal coverage grid generation finished!")
        print(f"Total circles: {total_circles} across {level} levels")
        return total_circles

    def close(self):
        """Close database connection"""
        self.conn.close()


def main():
    if len(sys.argv) < 2:
        print(
            "Usage: python generate_grid.py <country_code> [start_radius] [min_radius]"
        )
        sys.exit(1)

    country_code = sys.argv[1]
    start_radius = int(sys.argv[2]) if len(sys.argv) > 2 else 50000
    min_radius = int(sys.argv[3]) if len(sys.argv) > 3 else 100

    generator = OptimalCirclePackingGrid(country_code)
    generator._clear_existing_grid()

    try:
        total_circles = generator.generate_optimal_coverage_grid(
            start_radius, min_radius
        )
        print(f"\nSuccess: Generated {total_circles} circles for {country_code}")
        return {"success": True, "circles": total_circles}
    except Exception as e:
        print(f"Error: {e}")
        return {"success": False, "error": str(e)}
    finally:
        generator.close()


if __name__ == "__main__":
    result = main()
