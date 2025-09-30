import * as turf from "@turf/turf";
import { Bounds, Circle, Point } from "../types";

export class Geometry {
  static distance(p1: Point, p2: Point): number {
    const from = turf.point([p1.lng, p1.lat]);
    const to = turf.point([p2.lng, p2.lat]);
    return turf.distance(from, to, { units: "meters" });
  }

  static toDegrees(meters: number, lat = 0) {
    return {
      lat: (meters * 360) / 40008000,
      lng: (meters * 360) / (40075000 * Math.cos((lat * Math.PI) / 180)),
    };
  }

  static generateHexGrid(bounds: Bounds, radius: number): Point[] {
    const candidates: Point[] = [];
    const dyDeg = this.toDegrees(radius * 1.5).lat;
    let y = bounds.minY,
      row = 0;

    while (y <= bounds.maxY) {
      const { lng: dxDeg } = this.toDegrees(radius * 1.73, y);
      const { lng: offsetDeg } = this.toDegrees(radius * 0.866, y);
      let x = bounds.minX + (row % 2 ? offsetDeg : 0);

      while (x <= bounds.maxX) {
        candidates.push({ lng: x, lat: y });
        x += dxDeg;
      }
      y += dyDeg;
      row++;
    }
    return candidates;
  }

  static generatePackCandidates(
    parent: Point,
    parentRadius: number,
    minRadius: number
  ) {
    const candidates: Circle[] = [];
    let radius = parentRadius / 2.5;

    while (radius >= minRadius) {
      const latRad = parentRadius / 111320;
      const lngRad =
        parentRadius / (111320 * Math.cos((parent.lat * Math.PI) / 180));
      const latStep = (radius * 1.5) / 111320;
      let row = 0;

      for (
        let lat = parent.lat - latRad;
        lat <= parent.lat + latRad;
        lat += latStep
      ) {
        const lngStep =
          (radius * 1.732) / (111320 * Math.cos((lat * Math.PI) / 180));
        const offset =
          (radius * 0.866) / (111320 * Math.cos((lat * Math.PI) / 180));

        for (
          let lng = parent.lng - lngRad + (row % 2 ? offset : 0);
          lng <= parent.lng + lngRad;
          lng += lngStep
        ) {
          const center = { lng, lat };
          if (this.distance(center, parent) + radius <= parentRadius) {
            candidates.push({ center, radius });
          }
        }
        row++;
      }

      // Adaptive shrink rate: fine-grained above 1000m, aggressive below
      if (radius > 1000) {
        radius *= 0.999; // 0.1% reduction per iteration (fine-grained)
      } else {
        radius *= 0.98; // 1% reduction per iteration (aggressive)
      }
    }
    return candidates.sort((a, b) => b.radius - a.radius);
  }

  static packCircles(
    candidates: Circle[],
    obstacles: Array<{ center: Point; radius: number }>
  ): Circle[] {
    const packed: Circle[] = [];
    const gridSize = 0.01;

    // Build spatial index for obstacles with proper cell coverage
    const obstacleIndex = new Map<string, typeof obstacles>();
    for (const obs of obstacles) {
      const cells = this.getCellsForCircle(obs.center, obs.radius, gridSize);
      for (const cell of cells) {
        if (!obstacleIndex.has(cell)) obstacleIndex.set(cell, []);
        obstacleIndex.get(cell)!.push(obs);
      }
    }

    // Build spatial index for packed circles as we go
    const packedIndex = new Map<string, Circle[]>();

    for (const candidate of candidates) {
      // Get all cells this candidate overlaps
      const cells = this.getCellsForCircle(
        candidate.center,
        candidate.radius,
        gridSize
      );

      // Collect nearby obstacles and packed circles
      const nearby = new Set<{ center: Point; radius: number }>();
      for (const cell of cells) {
        obstacleIndex.get(cell)?.forEach((o) => nearby.add(o));
        packedIndex.get(cell)?.forEach((p) => nearby.add(p));
      }

      // Check for overlaps
      const hasOverlap = Array.from(nearby).some(
        (other) =>
          this.distance(candidate.center, other.center) <
          candidate.radius + other.radius
      );

      if (!hasOverlap) {
        packed.push(candidate);
        // Add to spatial index
        for (const cell of cells) {
          if (!packedIndex.has(cell)) packedIndex.set(cell, []);
          packedIndex.get(cell)!.push(candidate);
        }
      }
    }

    return packed;
  }

  // Helper to get all grid cells a circle overlaps
  private static getCellsForCircle(
    center: Point,
    radius: number,
    gridSize: number
  ): string[] {
    const cells: string[] = [];
    const radiusDeg = (radius / 111320) * 1.5; // Add buffer for safety

    const minLat = Math.floor((center.lat - radiusDeg) / gridSize);
    const maxLat = Math.ceil((center.lat + radiusDeg) / gridSize);
    const minLng = Math.floor((center.lng - radiusDeg) / gridSize);
    const maxLng = Math.ceil((center.lng + radiusDeg) / gridSize);

    for (let lat = minLat; lat <= maxLat; lat++) {
      for (let lng = minLng; lng <= maxLng; lng++) {
        cells.push(`${lat},${lng}`);
      }
    }

    return cells;
  }
}
