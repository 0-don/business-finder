import type { SQL } from "drizzle-orm";
import type {
  countryCodeEnum,
  languageEnum,
  placeTypeEnum,
} from "../db/schema";

export type CountryCode = (typeof countryCodeEnum.enumValues)[number];
export type Language = (typeof languageEnum.enumValues)[number];
export type PlaceType = (typeof placeTypeEnum.enumValues)[number];

export type Subdivision = {
  uid: number;
  countryName: string;
  isoA3: CountryCode;
  geometry: SQL<unknown>;
};

export interface SettingsConfig {
  id: number;
  countryCode: CountryCode;
  language: Language;
  placeType: PlaceType;
  keywords: string[];
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

export interface Circle {
  center: Point;
  radius: number;
}