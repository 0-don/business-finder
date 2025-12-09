declare namespace NodeJS {
  export interface ProcessEnv {
    DATABASE_URL: string;

    GOOGLE_MAPS_JAVASCRIPT_API: string;

    DEFAULT_COUNTRY_CODE?: import(".").CountryCode;
    RADIUS?: string;
    DEFAULT_PLACE_TYPE?: string;
  }
}
