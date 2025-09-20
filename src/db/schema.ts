import {
  boolean,
  decimal,
  integer,
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
    rating: decimal("rating", { precision: 3, scale: 2 }).notNull(),
    userRatingsTotal: integer("user_ratings_total").notNull(),
    latitude: decimal("latitude", { precision: 10, scale: 8 }).notNull(),
    longitude: decimal("longitude", { precision: 11, scale: 8 }).notNull(),
    businessType: text("business_type").notNull(),
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
  status: text("status").notNull(), // 'completed', 'error', 'partial'
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
