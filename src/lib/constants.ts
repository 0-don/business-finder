import { Client } from "@googlemaps/google-maps-services-js";
import { NaturalEarthGridManager } from "./natural-earth-grid";

export const CLIENT = new Client();
export const GRID_MANAGER = new NaturalEarthGridManager();
