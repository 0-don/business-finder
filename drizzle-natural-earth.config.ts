import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./src/db/natural-earth-schema",
  schema: "./src/db/natural-earth-schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: "./natural_earth_vector.sqlite",
  },
  introspect: {
    casing: "camel",
  },
});
