import { Client } from "@googlemaps/google-maps-services-js";
import { GridManager } from "./grid-manager";

export const CLIENT = new Client();
export const GRID_MANAGER = new GridManager();

export const MAX_PAGES_PER_CELL = 3;
export const RESULTS_PER_PAGE = 20;
export const MAX_RESULTS_PER_CELL = 60;
