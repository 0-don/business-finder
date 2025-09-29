declare namespace NodeJS {
  export interface ProcessEnv {
    DATABASE_URL: string;
    GOOGLE_PLACES_API: string;
    GOOGLE_MAPS_JAVASCRIPT_API: string;

    DEFAULT_COUNTRY_CODE?: import(".").CountryCode;
    DEFAULT_LANGUAGE?: import(".").Language;
    DEFAULT_PLACE_TYPE?: import(".").PlaceType;
    DEFAULT_KEYWORDS?: string;
  }
}
