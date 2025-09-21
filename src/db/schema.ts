// src/db/schema.ts
import {
  boolean,
  decimal,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const businessSchema = pgTable(
  "business",
  {
    id: serial("id").primaryKey(),
    placeId: text("place_id").notNull().unique(),
    name: text("name").notNull(),
    address: text("address").notNull(),
    vicinity: text("vicinity"),
    formattedAddress: text("formatted_address"),
    rating: decimal("rating", { precision: 3, scale: 2 }),
    userRatingsTotal: integer("user_ratings_total").default(0),
    latitude: decimal("latitude", { precision: 10, scale: 8 }).notNull(),
    longitude: decimal("longitude", { precision: 11, scale: 8 }).notNull(),
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
    h3Index: text("h3_index"), // Add this field
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_place_id").on(table.placeId),
    uniqueIndex("idx_location").on(table.latitude, table.longitude),
  ]
);

export const gridCellSchema = pgTable(
  "grid_cell",
  {
    id: serial("id").primaryKey(),
    h3Index: text("h3_index").notNull().unique(),
    resolution: integer("resolution").notNull(),
    latitude: decimal("latitude", { precision: 10, scale: 8 }).notNull(),
    longitude: decimal("longitude", { precision: 11, scale: 8 }).notNull(),
    isProcessed: boolean("is_processed").default(false),
    isExhausted: boolean("is_exhausted").default(false),
    currentPage: integer("current_page").default(0),
    nextPageToken: text("next_page_token"),
    totalResults: integer("total_results").default(0),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("idx_h3_index").on(table.h3Index)]
);

export const searchLogSchema = pgTable("search_log", {
  id: serial("id").primaryKey(),
  h3Index: text("h3_index").notNull(), // Add this field
  resolution: integer("resolution").notNull(), // Add this field
  latitude: decimal("latitude", { precision: 10, scale: 8 }).notNull(),
  longitude: decimal("longitude", { precision: 11, scale: 8 }).notNull(),
  resultsFound: integer("results_found").notNull(),
  pageNumber: integer("page_number").notNull(), // Add this field
  searchedAt: timestamp("searched_at").defaultNow(),
});

export const searchStateSchema = pgTable("search_state", {
  id: serial("id").primaryKey(),
  regionIndex: integer("region_index").notNull().default(0),
  pageIndex: integer("page_index").notNull().default(0),
  nextPageToken: text("next_page_token"),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});
