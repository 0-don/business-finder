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
import { COUNTRY_CODES } from "../lib/constants";

export const countryCodeEnum = pgEnum("country_code", COUNTRY_CODES);

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

export const settingsSchema = pgTable(
  "settings",
  {
    id: serial("id").primaryKey(),
    countryCode: countryCodeEnum("country_code").notNull(),
    placeType: varchar("place_type").notNull(),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_settings_unique_config").on(
      table.countryCode,
      table.placeType
    ),
    index("idx_settings_active_lookup").on(table.countryCode, table.isActive),
  ]
);

export const gadmSubdivisions = pgTable("gadm_subdivisions", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull().unique(),
  countryName: varchar("country_name", { length: 256 }).notNull(),
  isoA3: countryCodeEnum("isoA3").notNull(),
  geometry: geometry("geometry").notNull(),
});

export const countries = pgTable("countries", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  isoA3: countryCodeEnum("isoA3").notNull().unique(),
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
    settingsId: integer("settings_id")
      .notNull()
      .references(() => settingsSchema.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_place_id").on(table.placeId),
    index("idx_business_settings").on(table.settingsId),
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
    settingsId: integer("settings_id")
      .notNull()
      .references(() => settingsSchema.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_grid_center_gist").using("gist", table.center),
    index("idx_grid_circle_gist").using("gist", table.circle),
    index("idx_grid_settings").on(table.settingsId),
  ]
);

export const settingsRelations = relations(settingsSchema, ({ many }) => ({
  businesses: many(businessSchema),
  gridCells: many(gridCellSchema),
}));

export const businessRelations = relations(businessSchema, ({ one }) => ({
  settings: one(settingsSchema, {
    fields: [businessSchema.settingsId],
    references: [settingsSchema.id],
  }),
}));

export const gridCellRelations = relations(gridCellSchema, ({ one }) => ({
  settings: one(settingsSchema, {
    fields: [gridCellSchema.settingsId],
    references: [settingsSchema.id],
  }),
}));
