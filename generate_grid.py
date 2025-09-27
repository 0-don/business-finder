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

    def clear_grid(self):
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM grid_cell")
            self.conn.commit()
            print("Grid cleared")

    def get_valid_placements(
        self, candidates: List[Tuple[float, float]], radius_meters: float
    ) -> List[Tuple[float, float]]:
        if not candidates:
            return []

        # Create a string of values for the SQL query
        values_sql = ", ".join(f"({lng}, {lat})" for lng, lat in candidates)

        with self.conn.cursor() as cur:
            # This single, powerful query performs all checks at once.
            # 1. It creates a temporary table of all candidate points.
            # 2. It checks which of them are fully within the country's geometry.
            # 3. It checks that none of them overlap with circles already in the grid_cell table.
            query = f"""
                WITH candidates (lng, lat) AS (
                    VALUES {values_sql}
                )
                SELECT c.lng, c.lat
                FROM candidates c
                JOIN countries co ON co.iso_a3 = %s
                WHERE
                    -- Check 1: The entire circle must be within the country
                    ST_Within(
                        ST_Buffer(ST_Point(c.lng, c.lat, 4326)::geography, %s)::geometry,
                        co.geometry
                    )
                    AND
                    -- Check 2: The circle must not overlap with any existing circles
                    NOT EXISTS (
                        SELECT 1
                        FROM grid_cell gc
                        WHERE ST_DWithin(
                            ST_Point(c.lng, c.lat, 4326)::geography,
                            gc.center::geography,
                            %s + gc.radius_meters + 1  -- The +1 meter buffer prevents touching
                        )
                    );
            """
            cur.execute(query, (self.country_code, radius_meters, radius_meters))
            return cur.fetchall()

    def insert_circles(
        self, circles: List[Tuple[float, float]], radius_meters: float, level: int
    ):
        if not circles:
            return
        with self.conn.cursor() as cur:
            # Use mogrify for safe, efficient bulk insertion
            args_str = b",".join(cur.mogrify("(%s, %s, %s, %s)", (lng, lat, radius_meters, level)) for lng, lat in circles).decode('utf-8')
            cur.execute(f"""
                INSERT INTO grid_cell (center, radius_meters, circle, level)
                SELECT
                    ST_Point(d.lng, d.lat, 4326),
                    d.radius_meters,
                    ST_Buffer(ST_Point(d.lng, d.lat, 4326)::geography, d.radius_meters)::geometry,
                    d.level
                FROM (VALUES {args_str}) AS d(lng, lat, radius_meters, level);
            """)
            self.conn.commit()

    def get_bounds(self) -> Tuple[float, float, float, float]:
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT ST_XMin(geometry), ST_YMin(geometry), ST_XMax(geometry), ST_YMax(geometry) FROM countries WHERE iso_a3 = %s",
                (self.country_code,),
            )
            result = cur.fetchone()
            if not result:
                raise ValueError(f"Could not get bounds for country {self.country_code}")
            return result

    def close(self):
        self.conn.close()

class HexGridGenerator:
    def __init__(self, config: GridConfig):
        self.config = config
        self.db = DatabaseManager(config.country_code)

    @staticmethod
    def meters_to_degrees_lat(meters: float) -> float:
        return meters / 111320.0

    @staticmethod
    def meters_to_degrees_lng(meters: float, lat: float) -> float:
        if abs(lat) >= 90.0: lat = 89.99
        return meters / (111320.0 * math.cos(math.radians(lat)))

    def generate_hex_candidates(self, bounds: Tuple[float, float, float, float], radius_meters: float) -> List[Tuple[float, float]]:
        minx, miny, maxx, maxy = bounds
        candidates = []
        dy_deg = self.meters_to_degrees_lat(radius_meters * math.sqrt(3))
        y = miny
        row = 0
        while y <= maxy:
            dx_deg = self.meters_to_degrees_lng(radius_meters * 2, y)
            radius_deg_lng = self.meters_to_degrees_lng(radius_meters, y)
            x_start = minx + (radius_deg_lng if row % 2 == 1 else 0)
            x = x_start
            while x <= maxx:
                candidates.append((x, y))
                x += dx_deg
            y += dy_deg
            row += 1
        return candidates

    def can_place_circles_at_radius(self, radius_meters: int) -> int:
        bounds = self.db.get_bounds()
        candidates = self.generate_hex_candidates(bounds, radius_meters)
        return len(self.db.get_valid_placements(candidates, radius_meters))

    def find_optimal_radius(self, max_radius: int) -> Optional[int]:
        for radius in range(max_radius, self.config.min_radius - 1, -self.config.step_size):
            if self.can_place_circles_at_radius(radius) > 0:
                return radius
        return None

    def generate_level(self, radius_meters: int, level: int) -> int:
        print(f"Level {level}: radius {radius_meters}m")
        bounds = self.db.get_bounds()
        
        candidates = self.generate_hex_candidates(bounds, radius_meters)
        
        # The key change: We get all valid, non-overlapping placements from the DB in one shot.
        # This is efficient and correctly handles overlaps between candidates.
        placements = self.db.get_valid_placements(candidates, radius_meters)
        
        self.db.insert_circles(placements, radius_meters, level)
        print(f"  Placed {len(placements)} circles")
        return len(placements)

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

        total_circles, level = 0, 0
        while current_radius >= self.config.min_radius:
            placed = self.generate_level(current_radius, level)
            total_circles += placed

            if placed == 0 and level == 0:
                print("Could not place circles at starting radius. Halving and retrying.")
                current_radius = int(current_radius * 0.5)
                if current_radius < self.config.min_radius: break
                continue
            
            optimal_radius = self.find_optimal_radius(current_radius - 1)
            if optimal_radius:
                current_radius = optimal_radius
                level += 1
            else:
                break

            if level > 100:
                print("Stopping after 100 levels to prevent infinite loop.")
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
        country_code=sys.argv[1].upper(),
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