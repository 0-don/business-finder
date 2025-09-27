import os
import math
import psycopg2
from typing import List, Tuple, Optional
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


@dataclass
class GridConfig:
    country_code: str
    max_radius: int = 50000
    min_radius: int = 100
    step_size: int = 50


class DatabaseManager:
    def __init__(self, country_code: str):
        self.conn = psycopg2.connect(os.getenv("DATABASE_URL"))
        self.country_code = country_code
        self._boundary_wkt = None

    def get_country_boundary(self):
        if self._boundary_wkt is None:
            with self.conn.cursor() as cur:
                cur.execute(
                    "SELECT ST_AsText(geometry) FROM countries WHERE iso_a3 = %s",
                    (self.country_code,),
                )
                result = cur.fetchone()
                if not result:
                    raise ValueError(f"Country {self.country_code} not found")
                self._boundary_wkt = result[0]
        return self._boundary_wkt

    def clear_grid(self):
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM grid_cell")
            self.conn.commit()
            print("Grid cleared")

    def check_no_overlaps(
        self, candidates: List[Tuple[float, float]], radius_meters: float
    ) -> List[Tuple[float, float]]:
        if not candidates:
            return []
        valid_points = []
        with self.conn.cursor() as cur:
            for lng, lat in candidates:
                cur.execute(
                    """
                    SELECT EXISTS(
                        SELECT 1 FROM grid_cell gc
                        WHERE ST_DWithin(
                            ST_Point(%s, %s, 4326)::geography,
                            gc.center::geography,
                            %s + gc.radius_meters
                        )
                    )""",
                    (lng, lat, radius_meters),
                )
                if not cur.fetchone()[0]:
                    valid_points.append((lng, lat))
        return valid_points

    def check_within_country(
        self, points: List[Tuple[float, float]], radius_deg: float
    ) -> List[Tuple[float, float]]:
        if not points:
            return []
        valid_points = []
        boundary_wkt = self.get_country_boundary()
        with self.conn.cursor() as cur:
            for lng, lat in points:
                cur.execute(
                    """
                    SELECT ST_Within(
                        ST_Buffer(ST_Point(%s, %s, 4326), %s),
                        ST_GeomFromText(%s, 4326)
                    )""",
                    (lng, lat, radius_deg, boundary_wkt),
                )
                if cur.fetchone()[0]:
                    valid_points.append((lng, lat))
        return valid_points

    def insert_circles(
        self, circles: List[Tuple[float, float]], radius_meters: float, level: int
    ):
        if not circles:
            return
        with self.conn.cursor() as cur:
            for lng, lat in circles:
                cur.execute(
                    """
                    INSERT INTO grid_cell (center, radius_meters, circle, level)
                    VALUES (
                        ST_Point(%s, %s, 4326),
                        %s,
                        ST_Buffer(ST_Point(%s, %s, 4326)::geography, %s)::geometry,
                        %s
                    )""",
                    (lng, lat, radius_meters, lng, lat, radius_meters, level),
                )
            self.conn.commit()

    def get_bounds(self) -> Tuple[float, float, float, float]:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                SELECT ST_XMin(geometry), ST_YMin(geometry), ST_XMax(geometry), ST_YMax(geometry)
                FROM countries WHERE iso_a3 = %s
                """,
                (self.country_code,),
            )
            result = cur.fetchone()
            return result if result else (0, 0, 0, 0)

    def close(self):
        self.conn.close()


class HexGridGenerator:
    def __init__(self, config: GridConfig):
        self.config = config
        self.db = DatabaseManager(config.country_code)

    @staticmethod
    def meters_to_degrees(meters: float, lat: float) -> float:
        return meters / (111320 * math.cos(math.radians(lat)))

    def generate_hex_candidates(
        self, bounds: Tuple[float, float, float, float], radius_deg: float
    ) -> List[Tuple[float, float]]:
        minx, miny, maxx, maxy = bounds
        dx = radius_deg * 2.0
        dy = radius_deg * math.sqrt(3)
        candidates = []
        y = miny + radius_deg
        row = 0
        while y <= maxy - radius_deg:
            x_start = minx + radius_deg + (radius_deg if row % 2 == 1 else 0)
            x = x_start
            while x <= maxx - radius_deg:
                candidates.append((x, y))
                x += dx
            y += dy
            row += 1
        return candidates

    def can_place_circles_at_radius(self, radius_meters: int) -> int:
        bounds = self.db.get_bounds()
        avg_lat = (bounds[1] + bounds[3]) / 2
        radius_deg = self.meters_to_degrees(radius_meters, avg_lat)
        candidates = self.generate_hex_candidates(bounds, radius_deg)
        in_country = self.db.check_within_country(candidates, radius_deg)
        return len(self.db.check_no_overlaps(in_country, radius_meters))

    def find_optimal_radius(self, max_radius: int) -> Optional[int]:
        for radius in range(
            max_radius, self.config.min_radius - 1, -self.config.step_size
        ):
            if self.can_place_circles_at_radius(radius) > 0:
                return radius
        return None

    def generate_level(self, radius_meters: int, level: int) -> int:
        print(f"Level {level}: radius {radius_meters}m")
        bounds = self.db.get_bounds()
        avg_lat = (bounds[1] + bounds[3]) / 2
        radius_deg = self.meters_to_degrees(radius_meters, avg_lat)
        candidates = self.generate_hex_candidates(bounds, radius_deg)
        in_country = self.db.check_within_country(candidates, radius_deg)
        non_overlapping = self.db.check_no_overlaps(in_country, radius_meters)
        self.db.insert_circles(non_overlapping, radius_meters, level)
        print(f"  Placed {len(non_overlapping)} circles")
        return len(non_overlapping)

    def generate_grid(self) -> int:
        print(f"Starting grid generation for {self.config.country_code}")
        bounds = self.db.get_bounds()
        width_deg = bounds[2] - bounds[0]
        height_deg = bounds[3] - bounds[1]
        avg_lat = (bounds[1] + bounds[3]) / 2
        width_m = width_deg * 111320 * math.cos(math.radians(avg_lat))
        height_m = height_deg * 111320
        current_radius = min(int(min(width_m, height_m) / 10), self.config.max_radius)
        print(f"Starting radius: {current_radius}m")

        total_circles = 0
        level = 0

        while current_radius >= self.config.min_radius:
            placed = self.generate_level(current_radius, level)
            total_circles += placed

            if placed == 0:
                current_radius = max(self.config.min_radius, int(current_radius * 0.5))
                continue

            optimal_radius = self.find_optimal_radius(current_radius - 1)
            if optimal_radius:
                current_radius = optimal_radius
            else:
                break
            level += 1

            if level > 100:
                break

        print(f"Complete! {total_circles} total circles in {level} levels")
        return total_circles

    def close(self):
        self.db.close()


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

    generator = HexGridGenerator(config)
    try:
        generator.db.clear_grid()
        total = generator.generate_grid()
        print(f"Success: {total} circles generated")
    except Exception as e:
        print(f"Error: {e}")
        import traceback

        traceback.print_exc()
    finally:
        generator.close()


if __name__ == "__main__":
    main()
