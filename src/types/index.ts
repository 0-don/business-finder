export interface GridConfig {
  countryCode: string;
  maxRadius: number;
  minRadius: number;
}

export interface Point {
  lng: number;
  lat: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface BoundsRow {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

export interface CoordinateRow {
  lng: number;
  lat: number;
}
