import * as turf from "@turf/turf";
import { Bounds, Circle, Point } from "../types";

export class Geometry {
  /**
   * Calculate geodesic distance between two points using Turf.js
   * More accurate than Haversine approximation for large distances
   */
  static distance(p1: Point, p2: Point): number {
    const from = turf.point([p1.lng, p1.lat]);
    const to = turf.point([p2.lng, p2.lat]);
    return turf.distance(from, to, { units: "meters" });
  }

  /**
   * Generate hexagonal grid coverage for a bounding box
   * Uses Turf's optimized hex grid algorithm
   */
  static generateHexGrid(bounds: Bounds, radius: number): Point[] {
    const bbox: [number, number, number, number] = [
      bounds.minX,
      bounds.minY,
      bounds.maxX,
      bounds.maxY,
    ];

    // Calculate hex cell side length from desired radius
    const cellSide = (radius * 2) / Math.sqrt(3);
    const hexGrid = turf.hexGrid(bbox, cellSide, { units: "meters" });

    return hexGrid.features.map((feature) => {
      const center = turf.centroid(feature);
      return {
        lng: center.geometry.coordinates[0]!,
        lat: center.geometry.coordinates[1]!,
      };
    });
  }

  /**
   * Generate candidate circles for packing within a parent circle
   * Uses hexagonal packing pattern for optimal space utilization
   */
  static generatePackCandidates(
    parent: Point,
    parentRadius: number,
    minRadius: number
  ): Circle[] {
    const candidates: Circle[] = [];
    let radius = parentRadius / 2.5;

    while (radius >= minRadius) {
      // Create search area around parent
      const cellSide = (radius * 2) / Math.sqrt(3);
      const searchArea = turf.circle(
        turf.point([parent.lng, parent.lat]),
        parentRadius,
        { units: "meters" }
      );
      const bbox = turf.bbox(searchArea);

      // Generate hex grid within search area
      const hexGrid = turf.hexGrid(bbox, cellSide, { units: "meters" });

      for (const feature of hexGrid.features) {
        const center = turf.centroid(feature);
        const centerPoint: Point = {
          lng: center.geometry.coordinates[0]!,
          lat: center.geometry.coordinates[1]!,
        };

        // Fast distance check instead of polygon containment
        const distanceToParent = this.distance(centerPoint, parent);
        if (distanceToParent + radius <= parentRadius) {
          candidates.push({ center: centerPoint, radius });
        }
      }

      // Progressively smaller circles for tighter packing
      radius *= 0.85;
    }

    return candidates.sort((a, b) => b.radius - a.radius);
  }

  /**
   * Pack circles without overlaps using greedy algorithm
   * Fast implementation using distance-based overlap detection
   */
  static packCircles(
    candidates: Circle[],
    obstacles: Array<{ center: Point; radius: number }>
  ): Circle[] {
    const packed: Circle[] = [];

    for (const candidate of candidates) {
      let hasOverlap = false;

      // Check against all existing circles and obstacles
      for (const other of [...packed, ...obstacles]) {
        const distance = this.distance(candidate.center, other.center);

        // Two circles overlap if distance between centers < sum of radii
        if (distance < candidate.radius + other.radius) {
          hasOverlap = true;
          break;
        }
      }

      if (!hasOverlap) {
        packed.push(candidate);
      }
    }

    return packed;
  }
}
