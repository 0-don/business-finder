import type { SQL } from "drizzle-orm";
import type { countryCodeEnum } from "../db/schema";

export type CountryCode = (typeof countryCodeEnum.enumValues)[number];

export type Subdivision = {
  uid: number;
  countryName: string;
  isoA3: CountryCode;
  geometry: SQL<unknown>;
};

export interface SettingsConfig {
  id: number;
  countryCode: CountryCode;
  placeType: string;
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

export interface Circle {
  center: Point;
  radius: number;
}

export interface Viewport {
  north: number;
  south: number;
  east: number;
  west: number;
}
