CREATE TYPE "public"."country_code" AS ENUM('ABW', 'AFG', 'AGO', 'AIA', 'ALA', 'ALB', 'AND', 'ARE', 'ARG', 'ARM', 'ASM', 'ATA', 'ATF', 'ATG', 'AUS', 'AUT', 'AZE', 'BDI', 'BEL', 'BEN', 'BES', 'BFA', 'BGD', 'BGR', 'BHR', 'BHS', 'BIH', 'BLM', 'BLR', 'BLZ', 'BMU', 'BOL', 'BRA', 'BRB', 'BRN', 'BTN', 'BVT', 'BWA', 'CAF', 'CAN', 'CCK', 'CHE', 'CHL', 'CHN', 'CIV', 'CMR', 'COD', 'COG', 'COK', 'COL', 'COM', 'CPV', 'CRI', 'CUB', 'CUW', 'CXR', 'CYM', 'CYP', 'CZE', 'DEU', 'DJI', 'DMA', 'DNK', 'DOM', 'DZA', 'ECU', 'EGY', 'ERI', 'ESH', 'ESP', 'EST', 'ETH', 'FIN', 'FJI', 'FLK', 'FRA', 'FRO', 'FSM', 'GAB', 'GBR', 'GEO', 'GGY', 'GHA', 'GIB', 'GIN', 'GLP', 'GMB', 'GNB', 'GNQ', 'GRC', 'GRD', 'GRL', 'GTM', 'GUF', 'GUM', 'GUY', 'HMD', 'HND', 'HRV', 'HTI', 'HUN', 'IDN', 'IMN', 'IND', 'IOT', 'IRL', 'IRN', 'IRQ', 'ISL', 'ISR', 'ITA', 'JAM', 'JEY', 'JOR', 'JPN', 'KAZ', 'KEN', 'KGZ', 'KHM', 'KIR', 'KNA', 'KOR', 'KWT', 'LAO', 'LBN', 'LBR', 'LBY', 'LCA', 'LIE', 'LKA', 'LSO', 'LTU', 'LUX', 'LVA', 'MAF', 'MAR', 'MCO', 'MDA', 'MDG', 'MDV', 'MEX', 'MHL', 'MKD', 'MLI', 'MLT', 'MMR', 'MNE', 'MNG', 'MNP', 'MOZ', 'MRT', 'MSR', 'MTQ', 'MUS', 'MWI', 'MYS', 'MYT', 'NAM', 'NCL', 'NER', 'NFK', 'NGA', 'NIC', 'NIU', 'NLD', 'NOR', 'NPL', 'NRU', 'NZL', 'OMN', 'PAK', 'PAN', 'PCN', 'PER', 'PHL', 'PLW', 'PNG', 'POL', 'PRI', 'PRK', 'PRT', 'PRY', 'PSE', 'PYF', 'QAT', 'REU', 'ROU', 'RUS', 'RWA', 'SAU', 'SDN', 'SEN', 'SGP', 'SGS', 'SHN', 'SJM', 'SLB', 'SLE', 'SLV', 'SMR', 'SOM', 'SPM', 'SRB', 'SSD', 'STP', 'SUR', 'SVK', 'SVN', 'SWE', 'SWZ', 'SXM', 'SYC', 'SYR', 'TCA', 'TCD', 'TGO', 'THA', 'TJK', 'TKL', 'TKM', 'TLS', 'TON', 'TTO', 'TUN', 'TUR', 'TUV', 'TWN', 'TZA', 'UGA', 'UKR', 'UMI', 'URY', 'USA', 'UZB', 'VAT', 'VCT', 'VEN', 'VGB', 'VIR', 'VNM', 'VUT', 'WLF', 'WSM', 'XAD', 'XCA', 'XCL', 'XKO', 'XPI', 'XSP', 'YEM', 'Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z07', 'Z08', 'Z09', 'ZAF', 'ZMB', 'ZNC', 'ZWE');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('ar', 'be', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'en-Au', 'en-GB', 'es', 'eu', 'fa', 'fi', 'fil', 'fr', 'gl', 'gu', 'hi', 'hr', 'hu', 'id', 'it', 'iw', 'ja', 'kk', 'kn', 'ko', 'ky', 'lt', 'lv', 'mk', 'ml', 'mr', 'my', 'nl', 'no', 'pa', 'pl', 'pt', 'pt-BR', 'pt-PT', 'ro', 'ru', 'sk', 'sl', 'sq', 'sr', 'sv', 'ta', 'te', 'th', 'tl', 'tr', 'uk', 'uz', 'vi', 'zh-CN', 'zh-TW');--> statement-breakpoint
CREATE TYPE "public"."place_type" AS ENUM('accounting', 'airport', 'amusement_park', 'aquarium', 'art_gallery', 'atm', 'bakery', 'bank', 'bar', 'beauty_salon', 'bicycle_store', 'book_store', 'bowling_alley', 'bus_station', 'cafe', 'campground', 'car_dealer', 'car_rental', 'car_repair', 'car_wash', 'casino', 'cemetery', 'church', 'city_hall', 'clothing_store', 'convenience_store', 'courthouse', 'dentist', 'department_store', 'doctor', 'drugstore', 'electrician', 'electronics_store', 'embassy', 'fire_station', 'florist', 'funeral_home', 'furniture_store', 'gas_station', 'gym', 'hair_care', 'hardware_store', 'hindu_temple', 'home_goods_store', 'hospital', 'insurance_agency', 'jewelry_store', 'laundry', 'lawyer', 'library', 'light_rail_station', 'liquor_store', 'local_government_office', 'locksmith', 'lodging', 'meal_delivery', 'meal_takeaway', 'mosque', 'movie_rental', 'movie_theater', 'moving_company', 'museum', 'night_club', 'painter', 'park', 'parking', 'pet_store', 'pharmacy', 'physiotherapist', 'plumber', 'police', 'post_office', 'real_estate_agency', 'restaurant', 'roofing_contractor', 'rv_park', 'school', 'secondary_school', 'shoe_store', 'shopping_mall', 'spa', 'stadium', 'storage', 'store', 'subway_station', 'supermarket', 'synagogue', 'taxi_stand', 'tourist_attraction', 'train_station', 'transit_station', 'travel_agency', 'university', 'veterinary_care', 'zoo', 'administrative_area_level_1', 'administrative_area_level_2', 'administrative_area_level_3', 'administrative_area_level_4', 'administrative_area_level_5', 'archipelago', 'colloquial_area', 'continent', 'country', 'establishment', 'finance', 'floor', 'food', 'general_contractor', 'geocode', 'health', 'intersection', 'landmark', 'locality', 'natural_feature', 'neighborhood', 'place_of_worship', 'plus_code', 'point_of_interest', 'political', 'post_box', 'postal_code', 'postal_code_prefix', 'postal_code_suffix', 'postal_town', 'premise', 'room', 'route', 'street_address', 'street_number', 'sublocality', 'sublocality_level_1', 'sublocality_level_2', 'sublocality_level_3', 'sublocality_level_4', 'sublocality_level_5', 'subpremise', 'town_square');--> statement-breakpoint
CREATE TABLE "business" (
	"id" serial PRIMARY KEY NOT NULL,
	"place_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"vicinity" text,
	"formatted_address" text,
	"rating" double precision,
	"user_ratings_total" integer DEFAULT 0,
	"location" geometry(Point, 4326) NOT NULL,
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
	"country_code" "country_code" NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "business_place_id_unique" UNIQUE("place_id")
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"iso_a3" varchar(3) NOT NULL,
	"geometry" geometry(Geometry, 4326) NOT NULL,
	CONSTRAINT "countries_iso_a3_unique" UNIQUE("iso_a3")
);
--> statement-breakpoint
CREATE TABLE "gadm_subdivisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"uid" integer NOT NULL,
	"country_name" varchar(256) NOT NULL,
	"iso_a3" varchar(3) NOT NULL,
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
	"country_code" "country_code" NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"country_code" "country_code" NOT NULL,
	"language" "language" NOT NULL,
	"place_type" "place_type" NOT NULL,
	"keywords" text NOT NULL,
	"max_radius" double precision DEFAULT 50000,
	"min_radius" double precision DEFAULT 100,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_place_id" ON "business" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX "idx_location_gist" ON "business" USING gist ("location");--> statement-breakpoint
CREATE INDEX "idx_business_country" ON "business" USING btree ("country_code");--> statement-breakpoint
CREATE INDEX "idx_grid_center_gist" ON "grid_cell" USING gist ("center");--> statement-breakpoint
CREATE INDEX "idx_grid_circle_gist" ON "grid_cell" USING gist ("circle");--> statement-breakpoint
CREATE INDEX "idx_grid_country" ON "grid_cell" USING btree ("country_code");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_settings_unique_config" ON "settings" USING btree ("country_code","language","place_type","keywords");--> statement-breakpoint
CREATE INDEX "idx_settings_active_lookup" ON "settings" USING btree ("country_code","is_active");