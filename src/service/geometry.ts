import * as turf from "@turf/turf";
import { Bounds, Circle, Point } from "../types";

export class Geometry {
  static distance(p1: Point, p2: Point): number {
    const from = turf.point([p1.lng, p1.lat]);
    const to = turf.point([p2.lng, p2.lat]);
    return turf.distance(from, to, { units: "meters" });
  }

  static generateHexGrid(bounds: Bounds, radius: number): Point[] {
    const bbox: [number, number, number, number] = [
      bounds.minX,
      bounds.minY,
      bounds.maxX,
      bounds.maxY,
    ];
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

  static generatePackCandidates(
    parent: Point,
    parentRadius: number,
    minRadius: number
  ): Circle[] {
    const candidates: Circle[] = [];
    let radius = parentRadius / 2.5;

    const parentPoint = turf.point([parent.lng, parent.lat]);
    const parentCircle = turf.circle(parentPoint, parentRadius, {
      units: "meters",
    });

    while (radius >= minRadius) {
      const cellSide = (radius * 2) / Math.sqrt(3);
      const searchBuffer = turf.circle(parentPoint, parentRadius, {
        units: "meters",
      });
      const bbox = turf.bbox(searchBuffer);

      const hexGrid = turf.hexGrid(bbox, cellSide, { units: "meters" });

      for (const feature of hexGrid.features) {
        const center = turf.centroid(feature);
        const centerPoint: Point = {
          lng: center.geometry.coordinates[0]!,
          lat: center.geometry.coordinates[1]!,
        };

        const candidateCircle = turf.circle(center, radius, {
          units: "meters",
        });

        if (turf.booleanWithin(candidateCircle, parentCircle)) {
          candidates.push({ center: centerPoint, radius });
        }
      }

      radius *= 0.85;
    }

    return candidates.sort((a, b) => b.radius - a.radius);
  }

  static packCircles(
    candidates: Circle[],
    obstacles: Array<{ center: Point; radius: number }>
  ): Circle[] {
    const packed: Circle[] = [];

    for (const candidate of candidates) {
      const candidatePoint = turf.point([
        candidate.center.lng,
        candidate.center.lat,
      ]);
      const candidateCircle = turf.circle(candidatePoint, candidate.radius, {
        units: "meters",
      });

      let hasOverlap = false;

      for (const other of [...packed, ...obstacles]) {
        const otherPoint = turf.point([other.center.lng, other.center.lat]);
        const otherCircle = turf.circle(otherPoint, other.radius, {
          units: "meters",
        });

        if (
          turf.booleanOverlap(candidateCircle, otherCircle) ||
          turf.booleanContains(candidateCircle, otherCircle) ||
          turf.booleanContains(otherCircle, candidateCircle)
        ) {
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
