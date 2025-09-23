export interface BoundsResult {
  min_lng: number;
  min_lat: number;
  max_lng: number;
  max_lat: number;
}

export interface GridPoints {
  cell_id: string;
  lng: number;
  lat: number;
}

export interface GeoJSONGeometry {
  type: string;
  coordinates: number[][][] | number[][][][];
}
