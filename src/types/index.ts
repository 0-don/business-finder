import type {
  countryCodeEnum,
  languageEnum,
  placeTypeEnum,
} from "../db/schema";

export type CountryCode = (typeof countryCodeEnum.enumValues)[number];
export type Language = (typeof languageEnum.enumValues)[number];
export type PlaceType = (typeof placeTypeEnum.enumValues)[number];

export interface SettingsConfig {
  countryCode: CountryCode;
  language: Language;
  placeType: PlaceType;
  keywords: string[];
  maxRadius: number;
  minRadius: number;
}

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
