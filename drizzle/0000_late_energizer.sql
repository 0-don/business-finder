CREATE TYPE "public"."country_code" AS ENUM('ABW', 'AFG', 'AGO', 'AIA', 'ALA', 'ALB', 'AND', 'ARE', 'ARG', 'ARM', 'ASM', 'ATA', 'ATF', 'ATG', 'AUS', 'AUT', 'AZE', 'BDI', 'BEL', 'BEN', 'BES', 'BFA', 'BGD', 'BGR', 'BHR', 'BHS', 'BIH', 'BLM', 'BLR', 'BLZ', 'BMU', 'BOL', 'BRA', 'BRB', 'BRN', 'BTN', 'BVT', 'BWA', 'CAF', 'CAN', 'CCK', 'CHE', 'CHL', 'CHN', 'CIV', 'CMR', 'COD', 'COG', 'COK', 'COL', 'COM', 'CPV', 'CRI', 'CUB', 'CUW', 'CXR', 'CYM', 'CYP', 'CZE', 'DEU', 'DJI', 'DMA', 'DNK', 'DOM', 'DZA', 'ECU', 'EGY', 'ERI', 'ESH', 'ESP', 'EST', 'ETH', 'FIN', 'FJI', 'FLK', 'FRA', 'FRO', 'FSM', 'GAB', 'GBR', 'GEO', 'GGY', 'GHA', 'GIB', 'GIN', 'GLP', 'GMB', 'GNB', 'GNQ', 'GRC', 'GRD', 'GRL', 'GTM', 'GUF', 'GUM', 'GUY', 'HMD', 'HND', 'HRV', 'HTI', 'HUN', 'IDN', 'IMN', 'IND', 'IOT', 'IRL', 'IRN', 'IRQ', 'ISL', 'ISR', 'ITA', 'JAM', 'JEY', 'JOR', 'JPN', 'KAZ', 'KEN', 'KGZ', 'KHM', 'KIR', 'KNA', 'KOR', 'KWT', 'LAO', 'LBN', 'LBR', 'LBY', 'LCA', 'LIE', 'LKA', 'LSO', 'LTU', 'LUX', 'LVA', 'MAF', 'MAR', 'MCO', 'MDA', 'MDG', 'MDV', 'MEX', 'MHL', 'MKD', 'MLI', 'MLT', 'MMR', 'MNE', 'MNG', 'MNP', 'MOZ', 'MRT', 'MSR', 'MTQ', 'MUS', 'MWI', 'MYS', 'MYT', 'NAM', 'NCL', 'NER', 'NFK', 'NGA', 'NIC', 'NIU', 'NLD', 'NOR', 'NPL', 'NRU', 'NZL', 'OMN', 'PAK', 'PAN', 'PCN', 'PER', 'PHL', 'PLW', 'PNG', 'POL', 'PRI', 'PRK', 'PRT', 'PRY', 'PSE', 'PYF', 'QAT', 'REU', 'ROU', 'RUS', 'RWA', 'SAU', 'SDN', 'SEN', 'SGP', 'SGS', 'SHN', 'SJM', 'SLB', 'SLE', 'SLV', 'SMR', 'SOM', 'SPM', 'SRB', 'SSD', 'STP', 'SUR', 'SVK', 'SVN', 'SWE', 'SWZ', 'SXM', 'SYC', 'SYR', 'TCA', 'TCD', 'TGO', 'THA', 'TJK', 'TKL', 'TKM', 'TLS', 'TON', 'TTO', 'TUN', 'TUR', 'TUV', 'TWN', 'TZA', 'UGA', 'UKR', 'UMI', 'URY', 'USA', 'UZB', 'VAT', 'VCT', 'VEN', 'VGB', 'VIR', 'VNM', 'VUT', 'WLF', 'WSM', 'XAD', 'XCA', 'XCL', 'XKO', 'XPI', 'XSP', 'YEM', 'Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z07', 'Z08', 'Z09', 'ZAF', 'ZMB', 'ZNC', 'ZWE');--> statement-breakpoint
CREATE TABLE "business" (
	"id" serial PRIMARY KEY NOT NULL,
	"place_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"rating" double precision,
	"user_ratings_total" integer DEFAULT 0,
	"location" geometry(Point, 4326) NOT NULL,
	"types" jsonb,
	"website" text,
	"phone_number" text,
	"settings_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "business_place_id_unique" UNIQUE("place_id")
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"isoA3" "country_code" NOT NULL,
	"geometry" geometry(Geometry, 4326) NOT NULL,
	CONSTRAINT "countries_isoA3_unique" UNIQUE("isoA3")
);
--> statement-breakpoint
CREATE TABLE "gadm_subdivisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"uid" integer NOT NULL,
	"country_name" varchar(256) NOT NULL,
	"isoA3" "country_code" NOT NULL,
	"geometry" geometry(Geometry, 4326) NOT NULL,
	CONSTRAINT "gadm_subdivisions_uid_unique" UNIQUE("uid")
);
--> statement-breakpoint
CREATE TABLE "grid_cell" (
	"id" serial PRIMARY KEY NOT NULL,
	"center" geometry(Point, 4326) NOT NULL,
	"radius_meters" double precision NOT NULL,
	"circle" geometry(Geometry, 4326) NOT NULL,
	"level" integer NOT NULL,
	"is_processed" boolean DEFAULT false,
	"current_page" integer DEFAULT 0,
	"next_page_token" text,
	"total_results" integer DEFAULT 0,
	"settings_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"country_code" "country_code" NOT NULL,
	"place_type" varchar NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "business" ADD CONSTRAINT "business_settings_id_settings_id_fk" FOREIGN KEY ("settings_id") REFERENCES "public"."settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grid_cell" ADD CONSTRAINT "grid_cell_settings_id_settings_id_fk" FOREIGN KEY ("settings_id") REFERENCES "public"."settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_place_id" ON "business" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX "idx_business_settings" ON "business" USING btree ("settings_id");--> statement-breakpoint
CREATE INDEX "idx_grid_center_gist" ON "grid_cell" USING gist ("center");--> statement-breakpoint
CREATE INDEX "idx_grid_circle_gist" ON "grid_cell" USING gist ("circle");--> statement-breakpoint
CREATE INDEX "idx_grid_settings" ON "grid_cell" USING btree ("settings_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_settings_unique_config" ON "settings" USING btree ("country_code","place_type");--> statement-breakpoint
CREATE INDEX "idx_settings_active_lookup" ON "settings" USING btree ("country_code","is_active");