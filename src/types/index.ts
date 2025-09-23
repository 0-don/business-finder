export interface GridCell {
  cellId: string;
  lat: number;
  lng: number;
  radius: number;
  level: number;
}

export interface GridStats {
  level: number;
  total: number;
  processed: number;
}

export interface CellProgress {
  currentPage: number;
  nextPageToken?: string | null;
  totalResults: number;
}

export interface BoundsResult {
  min_lng: number;
  min_lat: number;
  max_lng: number;
  max_lat: number;
}

export interface GeoJSONGeometry {
  type: string;
  coordinates: number[][][] | number[][][][];
}
