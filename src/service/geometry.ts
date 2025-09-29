import { Bounds, Circle, Point } from "../types";

export class Geometry {
  static distance(p1: Point, p2: Point): number {
    const R = 6371e3;
    const rad1 = (p1.lat * Math.PI) / 180;
    const rad2 = (p2.lat * Math.PI) / 180;
    const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
    const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad1) * Math.cos(rad2) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
      const hasOverlap = [...packed, ...obstacles].some(
        (other) =>
          this.distance(candidate.center, other.center) <
          candidate.radius + other.radius
      );
      if (!hasOverlap) packed.push(candidate);
    }
    return packed;
  }
}
