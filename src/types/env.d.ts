declare namespace NodeJS {
  export interface ProcessEnv {
    DATABASE_URL: string;
    GOOGLE_CLOUD_PROJECT_ID: string;
    GOOGLE_APPLICATION_CREDENTIALS: string;
    GOOGLE_MAPS_API_KEY: string;
  }
}
