import { Client } from "@googlemaps/google-maps-services-js";
import { TurfGridManager } from "./turf-grid";

export const CLIENT = new Client();
export const GRID_MANAGER = new TurfGridManager();

export const MAX_PAGES_PER_CELL = 3;
export const RESULTS_PER_PAGE = 20;
export const MAX_RESULTS_PER_CELL = 60;
