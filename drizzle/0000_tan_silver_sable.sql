CREATE TABLE "business" (
	"id" serial PRIMARY KEY NOT NULL,
	"place_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"vicinity" text,
	"formatted_address" text,
	"rating" numeric(3, 2),
	"user_ratings_total" integer DEFAULT 0,
	"latitude" numeric(10, 8) NOT NULL,
	"longitude" numeric(11, 8) NOT NULL,
	"business_status" text,
	"types" jsonb,
	"opening_hours" jsonb,
	"photos" jsonb,
	"plus_code" jsonb,
	"icon" text,
	"icon_background_color" text,
	"icon_mask_base_uri" text,
	"price_level" integer,
	"website" text,
	"phone_number" text,
	"international_phone_number" text,
	"utc_offset" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "business_place_id_unique" UNIQUE("place_id")
);
--> statement-breakpoint
CREATE TABLE "grid_cell" (
	"id" serial PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"latitude" numeric(10, 8) NOT NULL,
	"longitude" numeric(11, 8) NOT NULL,
	"radius" integer NOT NULL,
	"level" integer NOT NULL,
	"is_processed" boolean DEFAULT false,
	"current_page" integer DEFAULT 0,
	"next_page_token" text,
	"total_results" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "grid_cell_cell_id_unique" UNIQUE("cell_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_place_id" ON "business" USING btree ("place_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_location" ON "business" USING btree ("latitude","longitude");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cell_id" ON "grid_cell" USING btree ("cell_id");