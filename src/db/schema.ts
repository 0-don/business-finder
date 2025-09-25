import {
  boolean,
  customType,
  decimal,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

const multipolygon = customType<{ data: string }>({
  dataType() {
    return "geometry(MultiPolygon, 4326)";
  },
});

const polygon = customType<{ data: string }>({
  dataType() {
    return "geometry(Polygon, 4326)";
  },
});

export const gadmSubdivisions = pgTable("gadm_subdivisions", {
  id: serial("id").primaryKey(),
  countryName: varchar("country_name", { length: 256 }).notNull(),
  isoA3: varchar("iso_a3", { length: 3 }).notNull(),
  geometry: multipolygon("geometry").notNull(),
});

export const countries = pgTable("countries", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  isoA3: varchar("iso_a3", { length: 3 }).notNull().unique(),
  geometry: multipolygon("geometry").notNull(),
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

export const gridCellSchema = pgTable(
  "grid_cell",
  {
    id: serial("id").primaryKey(),
    cellId: text("cell_id").notNull().unique(),
    latitude: decimal("latitude", { precision: 10, scale: 8 }).notNull(),
    longitude: decimal("longitude", { precision: 11, scale: 8 }).notNull(),
    radius: integer("radius").notNull(),
    circleGeometry: polygon("circle_geometry").notNull(),
    level: integer("level").notNull(),
    isProcessed: boolean("is_processed").default(false),
    currentPage: integer("current_page").default(0),
    nextPageToken: text("next_page_token"),
    totalResults: integer("total_results").default(0),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("idx_cell_id").on(table.cellId)]
);
