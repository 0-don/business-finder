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
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface ContainsResult {
  contains: number;
}

export interface GeoJSONGeometry {
  type: string;
  coordinates: number[][][] | number[][][][];
}
