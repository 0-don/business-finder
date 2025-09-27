import {
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

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

export const gadmSubdivisions = pgTable("gadm_subdivisions", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull().unique(),
  countryName: varchar("country_name", { length: 256 }).notNull(),
  isoA3: varchar("iso_a3", { length: 3 }).notNull(),
  geometry: geometry("geometry").notNull(),
});

export const countries = pgTable("countries", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  isoA3: varchar("iso_a3", { length: 3 }).notNull().unique(),
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
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_place_id").on(table.placeId),
    // Changed from uniqueIndex to regular index for GiST
    index("idx_location_gist").using("gist", table.location),
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
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Changed from uniqueIndex to regular index for GiST
    index("idx_grid_center_gist").using("gist", table.center),
    index("idx_grid_circle_gist").using("gist", table.circle),
  ]
);
