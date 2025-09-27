import os
import math
import psycopg2
from typing import List, Tuple, Optional
from dataclasses import dataclass
from dotenv import load_dotenv
from datetime import datetime
import humanize
from geopy.distance import geodesic
from geopy import Point

load_dotenv()


@dataclass
class GridConfig:
    country_code: str
    max_radius: int = 50000
    min_radius: int = 100


class DatabaseManager:
    def __init__(self, country_code: str):
        self.conn = psycopg2.connect(os.getenv("DATABASE_URL"))
        self.country_code = country_code
        self._bounds = None

    def clear_grid(self):
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM grid_cell")
            self.conn.commit()

    def get_valid_placements(
        self,
        candidates: List[Tuple[float, float]],
        radius: float,
        limit: Optional[int] = None,
    ) -> List[Tuple[float, float]]:
        if not candidates:
            return []

        values_sql = ", ".join(f"({lng}, {lat})" for lng, lat in candidates)
        limit_clause = f"LIMIT {limit}" if limit else ""

        with self.conn.cursor() as cur:
            cur.execute(
                f"""
                WITH candidates (lng, lat) AS (VALUES {values_sql})
                SELECT c.lng, c.lat FROM candidates c
                JOIN countries co ON co.iso_a3 = %s 
                WHERE ST_Within(ST_Buffer(ST_Point(c.lng, c.lat, 4326)::geography, %s)::geometry, co.geometry)
                AND NOT EXISTS (
                    SELECT 1 FROM grid_cell gc
                    WHERE ST_DWithin(ST_Point(c.lng, c.lat, 4326)::geography, gc.center::geography, %s + gc.radius_meters + 1)
                ) {limit_clause}
            """,
                (self.country_code, radius, radius),
            )
            return cur.fetchall()

    def insert_circles(
        self, circles: List[Tuple[float, float]], radius: float, level: int
    ):
        if not circles:
            return
        with self.conn.cursor() as cur:
            args_str = b",".join(
                cur.mogrify("(%s, %s, %s, %s)", (lng, lat, radius, level))
                for lng, lat in circles
            ).decode("utf-8")
            cur.execute(
                f"""
                INSERT INTO grid_cell (center, radius_meters, circle, level)
                SELECT ST_Point(d.lng, d.lat, 4326), d.radius_meters, 
                       ST_Buffer(ST_Point(d.lng, d.lat, 4326)::geography, d.radius_meters)::geometry, d.level
                FROM (VALUES {args_str}) AS d(lng, lat, radius_meters, level)
            """
            )
            self.conn.commit()

    def get_bounds(self) -> Tuple[float, float, float, float]:
        if self._bounds is None:
            with self.conn.cursor() as cur:
                cur.execute(
                    "SELECT ST_XMin(geometry), ST_YMin(geometry), ST_XMax(geometry), ST_YMax(geometry) FROM countries WHERE iso_a3 = %s",
                    (self.country_code,),
                )
                self._bounds = cur.fetchone()
        return self._bounds

    def close(self):
        self.conn.close()


class HexGridGenerator:
    def __init__(self, config: GridConfig):
        self.config = config
        self.db = DatabaseManager(config.country_code)
        self.start_time = datetime.now()
        self.total_circles = 0

    def meters_to_degrees(self, meters: float, lat: float = 0) -> Tuple[float, float]:
        point = Point(lat, 0)
        lat_dest = geodesic(meters=meters).destination(point, bearing=0)
        lng_dest = geodesic(meters=meters).destination(point, bearing=90)
        return abs(lat_dest.latitude - lat), abs(lng_dest.longitude)

    def generate_hex_candidates(
        self, bounds: Tuple[float, float, float, float], radius: float
    ) -> List[Tuple[float, float]]:
        minx, miny, maxx, maxy = bounds
        candidates = []
        dy_deg, _ = self.meters_to_degrees(radius * math.sqrt(3))

        y, row = miny, 0
        while y <= maxy:
            _, dx_deg = self.meters_to_degrees(radius * 2, y)
            _, radius_deg_lng = self.meters_to_degrees(radius, y)
            x_start = minx + (radius_deg_lng if row % 2 == 1 else 0)

            x = x_start
            while x <= maxx:
                candidates.append((x, y))
                x += dx_deg
            y += dy_deg
            row += 1
        return candidates

    def can_place_at_least_one(self, radius: int) -> bool:
        candidates = self.generate_hex_candidates(self.db.get_bounds(), radius)
        return len(self.db.get_valid_placements(candidates, radius, limit=1)) > 0

    def find_next_optimal_radius(self, max_radius: int) -> Optional[int]:
        step = max(50, (max_radius - self.config.min_radius) // 20)
        for radius in range(max_radius, self.config.min_radius - 1, -step):
            if self.can_place_at_least_one(radius):
                return radius
        return None

    def generate_level(self, radius: int, level: int) -> int:
        candidates = self.generate_hex_candidates(self.db.get_bounds(), radius)
        placements = self.db.get_valid_placements(candidates, radius)
        self.db.insert_circles(placements, radius, level)

        self.total_circles += len(placements)
        time_ago = humanize.naturaltime(datetime.now() - self.start_time)
        print(
            f"[{datetime.now().strftime('%H:%M:%S')}] Radius {radius}m: {len(placements)} circles (total: {self.total_circles}) - {time_ago}"
        )
        return len(placements)

    def generate_grid(self) -> int:
        print(f"Starting grid generation for {self.config.country_code}")
        current_radius, level = self.config.max_radius, 0

        while current_radius and current_radius >= self.config.min_radius:
            self.generate_level(current_radius, level)
            level += 1

            if current_radius <= self.config.min_radius:
                break

            next_rad = self.find_next_optimal_radius(current_radius - 1)
            current_radius = (
                next_rad
                if next_rad and next_rad < current_radius
                else int(current_radius * 0.85)
            )

        print(f"Complete! {self.total_circles} total circles in {level} levels")
        return self.total_circles

    def close(self):
        self.db.close()


def main():
    import sys

    country_code = sys.argv[1].upper() if len(sys.argv) > 1 else "DEU"

    generator = HexGridGenerator(GridConfig(country_code=country_code))
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
