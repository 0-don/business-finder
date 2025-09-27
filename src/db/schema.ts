import {
  Language,
  PlaceType1,
  PlaceType2,
} from "@googlemaps/google-maps-services-js";
import { relations } from "drizzle-orm";
import {
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import {
  COUNTRY_CODES,
  MAXIMUM_RADIUS,
  MINIMIUM_RADIUS,
} from "../lib/constants";

export const countryCodeEnum = pgEnum("country_code", COUNTRY_CODES);
export const languageEnum = pgEnum(
  "language",
  Object.values(Language) as [`${Language}`, ...`${Language}`[]]
);
export const placeTypeEnum = pgEnum("place_type", [
  ...Object.values(PlaceType1),
  ...Object.values(PlaceType2),
] as [`${PlaceType1 | PlaceType2}`, ...`${PlaceType1 | PlaceType2}`[]]);

// Custom geometry types
const geometry = customType<{ data: string }>({
  dataType() {
    return "geometry(Geometry, 4326)";
  },
});

const point = customType<{ data: string }>({
  dataType() {
    return "geometry(Point, 4326)";
  },
});

// Settings schema
export const settingsSchema = pgTable(
  "settings",
  {
    id: serial("id").primaryKey(),
    countryCode: countryCodeEnum("country_code").notNull(),
    language: languageEnum("language").notNull(),
    placeType: placeTypeEnum("place_type").notNull(),
    keywords: text("keywords").array().notNull(),
    maxRadius: doublePrecision("max_radius").default(MAXIMUM_RADIUS),
    minRadius: doublePrecision("min_radius").default(MINIMIUM_RADIUS),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_settings_unique_config").on(
      table.countryCode,
      table.language,
      table.placeType,
      table.keywords
    ),
    index("idx_settings_active_lookup").on(table.countryCode, table.isActive),
  ]
);

export const gadmSubdivisions = pgTable("gadm_subdivisions", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull().unique(),
  countryName: varchar("country_name", { length: 256 }).notNull(),
  isoA3: countryCodeEnum("country_code").notNull(),
  geometry: geometry("geometry").notNull(),
});

export const countries = pgTable("countries", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  isoA3: countryCodeEnum("country_code").notNull().unique(),
  geometry: geometry("geometry").notNull(),
});

export const businessSchema = pgTable(
  "business",
  {
    id: serial("id").primaryKey(),
    placeId: text("place_id").notNull().unique(),
    name: text("name").notNull(),
    address: text("address").notNull(),
    vicinity: text("vicinity"),
    formattedAddress: text("formatted_address"),
    rating: doublePrecision("rating"),
    userRatingsTotal: integer("user_ratings_total").default(0),
    location: point("location").notNull(),
    businessStatus: text("business_status"),
    types: jsonb("types").$type<string[]>(),
    openingHours: jsonb("opening_hours"),
    photos: jsonb("photos"),
    plusCode: jsonb("plus_code"),
    icon: text("icon"),
    iconBackgroundColor: text("icon_background_color"),
    iconMaskBaseUri: text("icon_mask_base_uri"),
    priceLevel: integer("price_level"),
    website: text("website"),
    phoneNumber: text("phone_number"),
    internationalPhoneNumber: text("international_phone_number"),
    utcOffset: integer("utc_offset"),
    countryCode: countryCodeEnum("country_code").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_place_id").on(table.placeId),
    index("idx_location_gist").using("gist", table.location),
    index("idx_business_country").on(table.countryCode),
  ]
);

export const gridCellSchema = pgTable(
  "grid_cell",
  {
    id: serial("id").primaryKey(),
    center: point("center").notNull(),
    radiusMeters: doublePrecision("radius_meters").notNull(),
    circle: geometry("circle").notNull(),
    level: integer("level").notNull(),
    isProcessed: boolean("is_processed").default(false),
    currentPage: integer("current_page").default(0),
    nextPageToken: text("next_page_token"),
    totalResults: integer("total_results").default(0),
    countryCode: countryCodeEnum("country_code").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_grid_center_gist").using("gist", table.center),
    index("idx_grid_circle_gist").using("gist", table.circle),
    index("idx_grid_country").on(table.countryCode),
  ]
);

// Relations
export const settingsRelations = relations(settingsSchema, ({ many }) => ({
  businesses: many(businessSchema),
  gridCells: many(gridCellSchema),
}));

export const businessRelations = relations(businessSchema, ({ one }) => ({
  settings: one(settingsSchema, {
    fields: [businessSchema.countryCode],
    references: [settingsSchema.countryCode],
  }),
}));

export const gridCellRelations = relations(gridCellSchema, ({ one }) => ({
  settings: one(settingsSchema, {
    fields: [gridCellSchema.countryCode],
    references: [settingsSchema.countryCode],
  }),
}));
