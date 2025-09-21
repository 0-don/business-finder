import { Client } from "@googlemaps/google-maps-services-js";
import { NaturalEarthGridManager } from "./natural-earth-grid";

export const CLIENT = new Client();
export const GRID_MANAGER = new NaturalEarthGridManager();

export const MAX_PAGES_PER_CELL = 3;
export const RESULTS_PER_PAGE = 20;
export const MAX_RESULTS_PER_CELL = 60; // 20 results × 3 pages - subdivision threshold
