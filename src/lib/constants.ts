import { Client } from "@googlemaps/google-maps-services-js";

export const CLIENT = new Client();

export const MAX_PAGES_PER_CELL = 3;
export const RESULTS_PER_PAGE = 20;
export const MAX_RESULTS_PER_CELL = 60;

export const COUNTRY_CODE = process.env.COUNTRY_CODE || "DEU";
