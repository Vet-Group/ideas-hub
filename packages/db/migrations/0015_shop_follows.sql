CREATE TABLE "shop_follows" (
	"store_id" text NOT NULL,
	"landing_domain" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_follows_store_id_landing_domain_pk" PRIMARY KEY("store_id","landing_domain")
);
--> statement-breakpoint
ALTER TABLE "shop_follows" ADD CONSTRAINT "shop_follows_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_follows" ADD CONSTRAINT "shop_follows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;