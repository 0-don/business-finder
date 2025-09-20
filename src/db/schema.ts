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

export const searchLogSchema = pgTable("search_log", {
  id: serial("id").primaryKey(),
  regionIndex: integer("region_index").notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 8 }).notNull(),
  longitude: decimal("longitude", { precision: 11, scale: 8 }).notNull(),
  resultsFound: integer("results_found").notNull(),
  totalPlaces: integer("total_places").notNull(),
  nextPageToken: text("next_page_token"),
  hasMorePages: boolean("has_more_pages").notNull().default(false),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  searchedAt: timestamp("searched_at").defaultNow(),
});

export const searchStateSchema = pgTable("search_state", {
  id: serial("id").primaryKey(),
  currentRegionIndex: integer("current_region_index").notNull().default(0),
  totalRegions: integer("total_regions").notNull(),
  isComplete: boolean("is_complete").notNull().default(false),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});
