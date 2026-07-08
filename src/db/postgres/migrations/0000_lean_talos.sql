CREATE TABLE "order_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shopify_order_id" varchar(64) NOT NULL,
	"shopify_order_name" varchar(32),
	"fulfillment_order_id" varchar(128) NOT NULL,
	"zappr_order_id" varchar(128),
	"shopify_fulfillment_id" varchar(128),
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"pincode" varchar(16),
	"slot" varchar(16),
	"surcharge_amount" numeric(8, 2),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_mappings_shopify_order_id_unique" UNIQUE("shopify_order_id"),
	CONSTRAINT "order_mappings_zappr_order_id_unique" UNIQUE("zappr_order_id")
);
--> statement-breakpoint
CREATE TABLE "tracking_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zappr_order_id" varchar(128) NOT NULL,
	"status" varchar(64),
	"tracking_number" varchar(128),
	"tracking_url" text,
	"raw_payload" jsonb,
	"synced_to_shopify" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shopify_order_id" varchar(64),
	"event_type" varchar(64),
	"hmac" varchar(256),
	"status" varchar(16) DEFAULT 'processing' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_shopify_order_id_unique" UNIQUE("shopify_order_id")
);
--> statement-breakpoint
CREATE TABLE "zappr_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direction" varchar(16) NOT NULL,
	"endpoint" text NOT NULL,
	"request_body" jsonb,
	"response_body" jsonb,
	"status_code" integer,
	"latency_ms" integer,
	"zappr_order_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_order_mappings_shopify_order_id" ON "order_mappings" USING btree ("shopify_order_id");--> statement-breakpoint
CREATE INDEX "idx_order_mappings_zappr_order_id" ON "order_mappings" USING btree ("zappr_order_id");--> statement-breakpoint
CREATE INDEX "idx_order_mappings_status" ON "order_mappings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_order_mappings_created_at" ON "order_mappings" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_tracking_updates_zappr_order_id" ON "tracking_updates" USING btree ("zappr_order_id");--> statement-breakpoint
CREATE INDEX "idx_tracking_updates_synced" ON "tracking_updates" USING btree ("synced_to_shopify");--> statement-breakpoint
CREATE INDEX "idx_tracking_updates_created_at" ON "tracking_updates" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_webhook_events_shopify_order_id" ON "webhook_events" USING btree ("shopify_order_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_events_created_at" ON "webhook_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_webhook_events_status" ON "webhook_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_zappr_logs_zappr_order_id" ON "zappr_logs" USING btree ("zappr_order_id");--> statement-breakpoint
CREATE INDEX "idx_zappr_logs_created_at" ON "zappr_logs" USING btree ("created_at");