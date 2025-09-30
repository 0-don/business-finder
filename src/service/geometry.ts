import * as turf from "@turf/turf";
import { Bounds, Circle, Point } from "../types";

export class Geometry {
  static distance(p1: Point, p2: Point): number {
    const from = turf.point([p1.lng, p1.lat]);
    const to = turf.point([p2.lng, p2.lat]);
    return turf.distance(from, to, { units: "meters" });
  }

  static toDegrees(meters: number, lat = 0) {
    const point = turf.point([0, lat]);
    const latPoint = turf.destination(point, meters / 1000, 0, {
      units: "kilometers",
    });
    const lngPoint = turf.destination(point, meters / 1000, 90, {
      units: "kilometers",
    });

    return {
      lat: Math.abs(latPoint.geometry.coordinates[1]! - lat),
      lng: Math.abs(lngPoint.geometry.coordinates[0]!),
    };
  }

  static generateHexGrid(bounds: Bounds, radius: number): Point[] {
    const bbox: [number, number, number, number] = [
      bounds.minX,
      bounds.minY,
      bounds.maxX,
      bounds.maxY,
    ];
    const cellSide = (radius * 2) / 1000;
    const hexGrid = turf.hexGrid(bbox, cellSide, { units: "kilometers" });

    return hexGrid.features
      .map((feature) => {
        const center = turf.centroid(feature);
        const lng = center.geometry.coordinates[0];
        const lat = center.geometry.coordinates[1];
        if (lng === undefined || lat === undefined) return null;
        return { lng, lat };
      })
      .filter((p): p is Point => p !== null);
  }

  static generatePackCandidates(
    parent: Point,
    parentRadius: number,
    minRadius: number
  ): Circle[] {
    const candidates: Circle[] = [];
    const center = turf.point([parent.lng, parent.lat]);
    let radius = parentRadius / 2.5;

    while (radius >= minRadius) {
      const parentCircle = turf.circle(center, parentRadius / 1000, {
        units: "kilometers",
        steps: 64,
      });

      const bbox = turf.bbox(parentCircle);
      const bbox4: [number, number, number, number] = [
        bbox[0],
        bbox[1],
        bbox[2],
        bbox[3],
      ];
      const cellSide = (radius * 1.732) / 1000;
      const hexGrid = turf.hexGrid(bbox4, cellSide, { units: "kilometers" });

      for (const hex of hexGrid.features) {
        const hexCenter = turf.centroid(hex);
        const lng = hexCenter.geometry.coordinates[0];
        const lat = hexCenter.geometry.coordinates[1];

        if (lng === undefined || lat === undefined) continue;

        const candidatePoint: Point = { lng, lat };
        const distToParent = this.distance(candidatePoint, parent);

        if (distToParent + radius <= parentRadius) {
          candidates.push({ center: candidatePoint, radius });
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

    const obstacleCircles = obstacles.map((obs) => ({
      circle: turf.circle([obs.center.lng, obs.center.lat], obs.radius / 1000, {
        units: "kilometers",
        steps: 32,
      }),
      ...obs,
    }));

    const gridSize = 0.01;
    const obstacleIndex = new Map<string, typeof obstacleCircles>();

    for (const obs of obstacleCircles) {
      const bbox = turf.bbox(obs.circle);
      const bbox4: [number, number, number, number] = [
        bbox[0],
        bbox[1],
        bbox[2],
        bbox[3],
      ];
      const cells = this.getCellsForBBox(bbox4, gridSize);
      for (const cell of cells) {
        if (!obstacleIndex.has(cell)) obstacleIndex.set(cell, []);
        obstacleIndex.get(cell)!.push(obs);
      }
    }

    const packedIndex = new Map<string, Circle[]>();

    for (const candidate of candidates) {
      const candidateCircle = turf.circle(
        [candidate.center.lng, candidate.center.lat],
        candidate.radius / 1000,
        { units: "kilometers", steps: 32 }
      );
      const bbox = turf.bbox(candidateCircle);
      const bbox4: [number, number, number, number] = [
        bbox[0],
        bbox[1],
        bbox[2],
        bbox[3],
      ];
      const cells = this.getCellsForBBox(bbox4, gridSize);

      const nearbyObstacles = new Set<(typeof obstacleCircles)[0]>();
      const nearbyPacked = new Set<Circle>();

      for (const cell of cells) {
        obstacleIndex.get(cell)?.forEach((o) => nearbyObstacles.add(o));
        packedIndex.get(cell)?.forEach((p) => nearbyPacked.add(p));
      }

      let hasOverlap = false;

      for (const obs of nearbyObstacles) {
        if (
          this.distance(candidate.center, obs.center) <
          candidate.radius + obs.radius
        ) {
          hasOverlap = true;
          break;
        }
      }

      if (!hasOverlap) {
        for (const packed of nearbyPacked) {
          if (
            this.distance(candidate.center, packed.center) <
            candidate.radius + packed.radius
          ) {
            hasOverlap = true;
            break;
          }
        }
      }

      if (!hasOverlap) {
        packed.push(candidate);
        for (const cell of cells) {
          if (!packedIndex.has(cell)) packedIndex.set(cell, []);
          packedIndex.get(cell)!.push(candidate);
        }
      }
    }

    return packed;
  }

  private static getCellsForBBox(
    bbox: [number, number, number, number],
    gridSize: number
  ): string[] {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const cells: string[] = [];

    const minLatCell = Math.floor(minLat / gridSize);
    const maxLatCell = Math.ceil(maxLat / gridSize);
    const minLngCell = Math.floor(minLng / gridSize);
    const maxLngCell = Math.ceil(maxLng / gridSize);

    for (let lat = minLatCell; lat <= maxLatCell; lat++) {
      for (let lng = minLngCell; lng <= maxLngCell; lng++) {
        cells.push(`${lat},${lng}`);
      }
    }

    return cells;
  }
}
