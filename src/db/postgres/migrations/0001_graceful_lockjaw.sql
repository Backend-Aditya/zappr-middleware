CREATE TABLE "zappr_synced_skus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" varchar(128) NOT NULL,
	"shopify_variant_id" varchar(128) NOT NULL,
	"shopify_inventory_item_id" varchar(128) NOT NULL,
	"last_quantity" integer,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zappr_synced_skus_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE INDEX "idx_zappr_synced_skus_sku" ON "zappr_synced_skus" USING btree ("sku");