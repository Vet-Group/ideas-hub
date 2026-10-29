CREATE TABLE "ad_angles" (
	"ad_archive_id" text PRIMARY KEY NOT NULL,
	"angle" text NOT NULL,
	"model" text NOT NULL,
	"cost_usd" numeric(10, 4) NOT NULL,
	"tagged_on" date NOT NULL,
	"tagged_at" timestamp with time zone,
	"attempts" smallint DEFAULT 1 NOT NULL,
	CONSTRAINT "ad_angles_angle_check" CHECK ("ad_angles"."angle" in ('pain', 'desire', 'proof', 'curiosity', 'urgency', 'identity', 'unclear'))
);
--> statement-breakpoint
ALTER TABLE "ad_angles" ADD CONSTRAINT "ad_angles_ad_archive_id_ads_ad_archive_id_fk" FOREIGN KEY ("ad_archive_id") REFERENCES "public"."ads"("ad_archive_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_angles_tagged_on_idx" ON "ad_angles" USING btree ("tagged_on");