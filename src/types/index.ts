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
