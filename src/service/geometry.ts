import { Bounds, Point } from "../types";

export class Geometry {
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
}
