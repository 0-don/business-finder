CREATE TABLE "business" (
	"id" serial PRIMARY KEY NOT NULL,
	"place_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"rating" numeric(3, 2) NOT NULL,
	"user_ratings_total" integer NOT NULL,
	"latitude" numeric(10, 8) NOT NULL,
	"longitude" numeric(11, 8) NOT NULL,
	"business_type" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "business_place_id_unique" UNIQUE("place_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_place_id" ON "business" USING btree ("place_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_location" ON "business" USING btree ("latitude","longitude");