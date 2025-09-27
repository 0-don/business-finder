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
                cur.execute("SELECT ST_AsText(geometry) FROM countries WHERE iso_a3 = %s", (self.country_code,))
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
        """Find the largest radius that can fit in the biggest uncovered gap"""
        with self.conn.cursor() as cur:
            cur.execute("""
                WITH country_bounds AS (
                    SELECT ST_XMin(geometry) as minx, ST_YMin(geometry) as miny,
                           ST_XMax(geometry) as maxx, ST_YMax(geometry) as maxy
                    FROM countries WHERE iso_a3 = %s
                ),
                sample_grid AS (
                    SELECT 
                        generate_series(minx, maxx, (maxx-minx)/50) as x,
                        generate_series(miny, maxy, (maxy-miny)/50) as y
                    FROM country_bounds
                ),
                uncovered_points AS (
                    SELECT sg.x, sg.y
                    FROM sample_grid sg, countries c
                    WHERE c.iso_a3 = %s 
                    AND ST_Contains(c.geometry, ST_Point(sg.x, sg.y, 4326))
                    AND NOT EXISTS (
                        SELECT 1 FROM grid_cell gc
                        WHERE ST_DWithin(
                            ST_Point(sg.x, sg.y, 4326)::geography,
                            ST_Centroid(gc.circle_geometry)::geography,
                            gc.radius
                        )
                    )
                ),
                gap_distances AS (
                    SELECT up.x, up.y,
                           COALESCE(MIN(ST_Distance(
                               ST_Point(up.x, up.y, 4326)::geography,
                               ST_Centroid(gc.circle_geometry)::geography
                           ) - gc.radius), %s) as min_distance_to_circle
                    FROM uncovered_points up
                    LEFT JOIN grid_cell gc ON true
                    GROUP BY up.x, up.y
                )
                SELECT MAX(min_distance_to_circle) as max_gap
                FROM gap_distances
            """, (self.country_code, self.country_code, max_radius))
            
            result = cur.fetchone()
            if result and result[0]:
                gap_radius = int(result[0] * 0.8)
                return max(min_radius, min(gap_radius, max_radius))
            return None

    def check_conflicts_batch(self, points: List[Tuple[float, float]], radius: int) -> List[bool]:
        if not points:
            return []
            
        with self.conn.cursor() as cur:
            cur.execute("CREATE TEMP TABLE temp_candidates (x FLOAT, y FLOAT)")
            cur.executemany("INSERT INTO temp_candidates VALUES (%s, %s)", points)
            
            cur.execute("""
                SELECT tc.x, tc.y,
                       EXISTS(
                           SELECT 1 FROM grid_cell g
                           WHERE ST_DWithin(
                               ST_Point(tc.x, tc.y, 4326)::geography,
                               ST_Centroid(g.circle_geometry)::geography,
                               %s + g.radius
                           )
                       ) as has_conflict
                FROM temp_candidates tc
                ORDER BY tc.x, tc.y
            """, (radius,))
            
            results = [not row[2] for row in cur.fetchall()]
            cur.execute("DROP TABLE temp_candidates")
            return results

    def insert_circles_batch(self, circles: List[Tuple[float, float]], radius: int, level: int):
        if not circles:
            return
            
        with self.conn.cursor() as cur:
            values = [(y, x, radius, level, x, y, radius) for x, y in circles]
            cur.executemany("""
                INSERT INTO grid_cell (latitude, longitude, radius, level, circle_geometry)
                VALUES (%s, %s, %s, %s, ST_Buffer(ST_Point(%s, %s, 4326)::geography, %s)::geometry)
            """, values)
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

    def generate_hex_points(self, bounds: Tuple[float, float, float, float], radius_deg: float) -> List[Tuple[float, float]]:
        minx, miny, maxx, maxy = bounds
        dx = radius_deg * 2
        dy = radius_deg * math.sqrt(3)
        
        points = []
        y = miny + radius_deg
        row = 0
        
        while y <= maxy - radius_deg:
            x_start = minx + radius_deg + (dx / 2 if row % 2 == 1 else 0)
            x = x_start
            while x <= maxx - radius_deg:
                points.append((x, y))
                x += dx
            y += dy
            row += 1
            
        return points

    def generate_level(self, radius: int, level: int) -> int:
        bounds = self.geometry.get_bounds()
        avg_lat = (bounds[1] + bounds[3]) / 2
        radius_deg = self.geometry.meters_to_degrees(radius, avg_lat)
        
        candidates = self.generate_hex_points(bounds, radius_deg)
        valid_candidates = [
            (x, y) for x, y in candidates
            if self.geometry.contains_circle(x, y, radius_deg)
        ]
        
        if not valid_candidates:
            return 0
        
        total_placed = 0
        for i in range(0, len(valid_candidates), self.config.batch_size):
            batch = valid_candidates[i:i + self.config.batch_size]
            conflict_results = self.db.check_conflicts_batch(batch, radius)
            valid_batch = [point for point, is_valid in zip(batch, conflict_results) if is_valid]
            
            if valid_batch:
                self.db.insert_circles_batch(valid_batch, radius, level)
                total_placed += len(valid_batch)
        
        return total_placed

    def calculate_initial_radius(self) -> int:
        bounds = self.geometry.get_bounds()
        width_deg = bounds[2] - bounds[0]
        height_deg = bounds[3] - bounds[1]
        avg_lat = (bounds[1] + bounds[3]) / 2
        
        width_m = width_deg * 111320 * math.cos(math.radians(avg_lat))
        height_m = height_deg * 111320
        return min(int(min(width_m, height_m) / 4), self.config.max_radius)

    def generate_complete_grid(self) -> int:
        current_radius = self.calculate_initial_radius()
        total_circles = 0
        level = 0
        
        while current_radius >= self.config.min_radius:
            placed = self.generate_level(current_radius, level)
            total_circles += placed
            print(f"Level {level} (radius {current_radius}m): {placed} circles (total: {total_circles})")
            
            if placed == 0:
                current_radius = max(self.config.min_radius, current_radius // 2)
            else:
                next_radius = self.db.find_largest_gap(self.config.min_radius, current_radius - 50)
                if next_radius is None or next_radius >= current_radius:
                    current_radius = max(self.config.min_radius, current_radius - 100)
                else:
                    current_radius = next_radius
                    
            level += 1
            
            if level > 100:
                print("Maximum levels reached")
                break
        
        return total_circles

    def close(self):
        self.geometry.conn.close()

def main():
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python generate_grid.py <country_code>")
        sys.exit(1)
    
    config = GridConfig(
        country_code=sys.argv[1],
        max_radius=int(sys.argv[2]) if len(sys.argv) > 2 else 50000,
        min_radius=int(sys.argv[3]) if len(sys.argv) > 3 else 100
    )
    
    generator = OptimalGridGenerator(config)
    generator.clear_grid()
    
    try:
        total = generator.generate_complete_grid()
        print(f"Success: {total} circles for {config.country_code}")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        generator.close()

if __name__ == "__main__":
    main()