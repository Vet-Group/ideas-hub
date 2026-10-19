-- Trigram search for Ctrl+K (ads caption, page name, landing domain).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "store_members" (
	"store_id" text NOT NULL,
	"user_id" text NOT NULL,
	"can_view" boolean DEFAULT false NOT NULL,
	"can_save" boolean DEFAULT false NOT NULL,
	"can_keywords" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_members_store_id_user_id_pk" PRIMARY KEY("store_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"erp_store_code" text,
	"pod_studio_store_id" text,
	"lark_chat_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_check" CHECK ("users"."role" in ('admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"run_id" text,
	"briefing_id" text,
	"cooldown_seq" integer,
	"affected_searches" integer,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"lark_message_id" text,
	"sent_at" timestamp with time zone,
	CONSTRAINT "alerts_kind_check" CHECK ("alerts"."kind" in ('blocked', 'network_error', 'parse_error', 'missed_run', 'run_failed', 'heartbeat_lost', 'briefing_late', 'lark_send_failed')),
	CONSTRAINT "alerts_ref_check" CHECK (case
        when "alerts"."kind" in ('blocked', 'parse_error', 'missed_run', 'run_failed') then "alerts"."run_id" is not null
        when "alerts"."kind" = 'network_error' then "alerts"."run_id" is not null and "alerts"."cooldown_seq" is not null
        when "alerts"."kind" in ('briefing_late', 'lark_send_failed') then "alerts"."briefing_id" is not null
        else true end)
);
--> statement-breakpoint
CREATE TABLE "briefings" (
	"id" text PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"scope" text NOT NULL,
	"keyword_id" text,
	"sections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"llm_calls" integer DEFAULT 0 NOT NULL,
	"ready_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "briefings_date_scope_key" UNIQUE NULLS NOT DISTINCT("date","scope","keyword_id"),
	CONSTRAINT "briefings_scope_check" CHECK ("briefings"."scope" in ('global', 'keyword')),
	CONSTRAINT "briefings_keyword_check" CHECK (("briefings"."scope" = 'keyword') = ("briefings"."keyword_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "lark_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"briefing_id" text NOT NULL,
	"chat" text NOT NULL,
	"uuid" text NOT NULL,
	"message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lark_messages_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"briefing_id" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suggestions_kind_check" CHECK ("suggestions"."kind" in ('idea', 'keyword'))
);
--> statement-breakpoint
CREATE TABLE "crawl_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"trigger" text NOT NULL,
	"scheduled_for" timestamp with time zone,
	"triggered_by" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"requested_pairs" jsonb,
	"planned_searches" integer NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"deadline" timestamp with time zone NOT NULL,
	"job_id" text,
	"blocked_until" timestamp with time zone,
	"block_reason" text,
	"close_reason" text,
	"two_page_stops_with_next" integer DEFAULT 0 NOT NULL,
	"transient_retries" integer DEFAULT 0 NOT NULL,
	"browser_restarts" integer DEFAULT 0 NOT NULL,
	"wait_limit_hits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"network_cooldowns" integer DEFAULT 0 NOT NULL,
	"running_ads" integer,
	"ok_searches" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crawl_runs_trigger_check" CHECK ("crawl_runs"."trigger" in ('schedule', 'manual', 'cli')),
	CONSTRAINT "crawl_runs_status_check" CHECK ("crawl_runs"."status" in ('scheduled', 'running', 'done', 'stopped', 'missed')),
	CONSTRAINT "crawl_runs_close_reason_check" CHECK ("crawl_runs"."close_reason" in ('not_started')),
	CONSTRAINT "crawl_runs_slot_check" CHECK (("crawl_runs"."trigger" = 'schedule') = ("crawl_runs"."scheduled_for" is not null)),
	CONSTRAINT "crawl_runs_pairs_check" CHECK ("crawl_runs"."trigger" <> 'schedule' or "crawl_runs"."requested_pairs" is null)
);
--> statement-breakpoint
CREATE TABLE "crawl_searches" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"keyword_id" text NOT NULL,
	"country" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"embedded_count" integer,
	"embedded_has_next" boolean,
	"total_count" integer,
	"ads_found" integer DEFAULT 0 NOT NULL,
	"pages_read" integer DEFAULT 0 NOT NULL,
	"last_has_next" boolean,
	"stop_reason" text,
	"reason" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "crawl_searches_status_check" CHECK ("crawl_searches"."status" in ('pending', 'running', 'ok', 'no_results', 'blocked', 'network_error', 'parse_error', 'interrupted', 'skipped')),
	CONSTRAINT "crawl_searches_stop_reason_check" CHECK ("crawl_searches"."stop_reason" in ('end_of_results', 'cap', 'no_new_ads'))
);
--> statement-breakpoint
CREATE TABLE "crawler_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"rotation_cursor" jsonb,
	"blocked_until" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	CONSTRAINT "crawler_state_single_row" CHECK ("crawler_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "keyword_days" (
	"keyword_id" text NOT NULL,
	"crawl_day" date NOT NULL,
	"slot" timestamp with time zone NOT NULL,
	"running_ads" integer NOT NULL,
	CONSTRAINT "keyword_days_keyword_id_crawl_day_slot_pk" PRIMARY KEY("keyword_id","crawl_day","slot")
);
--> statement-breakpoint
CREATE TABLE "keywords" (
	"id" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"origin" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "keywords_origin_check" CHECK ("keywords"."origin" in ('seed', 'store'))
);
--> statement-breakpoint
CREATE TABLE "run_time_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"run_times" jsonb NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"changed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_days" (
	"landing_domain" text NOT NULL,
	"crawl_day" date NOT NULL,
	"slot" timestamp with time zone NOT NULL,
	"running_ads" integer NOT NULL,
	CONSTRAINT "shop_days_landing_domain_crawl_day_slot_pk" PRIMARY KEY("landing_domain","crawl_day","slot")
);
--> statement-breakpoint
CREATE TABLE "store_keywords" (
	"store_id" text NOT NULL,
	"keyword_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_keywords_store_id_keyword_id_pk" PRIMARY KEY("store_id","keyword_id")
);
--> statement-breakpoint
CREATE TABLE "saved_ideas" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"via" text NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"image_key" text,
	"title" text NOT NULL,
	"notes" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"assignee_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_ideas_source_check" CHECK ("saved_ideas"."source" in ('ad', 'suggestion', 'manual')),
	CONSTRAINT "saved_ideas_via_check" CHECK ("saved_ideas"."via" in ('briefing', 'ads', 'manual')),
	CONSTRAINT "saved_ideas_status_check" CHECK ("saved_ideas"."status" in ('new', 'picked', 'done', 'dropped')),
	CONSTRAINT "saved_ideas_image_check" CHECK ("saved_ideas"."image_key" is null or "saved_ideas"."source" = 'manual')
);
--> statement-breakpoint
CREATE TABLE "ad_sightings" (
	"ad_archive_id" text NOT NULL,
	"run_id" text NOT NULL,
	"keyword_id" text NOT NULL,
	"country" text NOT NULL,
	"position" integer NOT NULL,
	"crawl_day" date NOT NULL,
	CONSTRAINT "ad_sightings_ad_archive_id_run_id_keyword_id_country_pk" PRIMARY KEY("ad_archive_id","run_id","keyword_id","country")
);
--> statement-breakpoint
CREATE TABLE "ads" (
	"ad_archive_id" text PRIMARY KEY NOT NULL,
	"collation_id" text,
	"collation_count" integer,
	"page_id" text,
	"page_name" text,
	"caption" text,
	"title" text,
	"link" text,
	"landing_domain" text,
	"cta" text,
	"media_type" text,
	"start_date" date,
	"end_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"seen_runs" integer DEFAULT 0 NOT NULL,
	"seen_days" integer DEFAULT 0 NOT NULL,
	"first_seen_date" date NOT NULL,
	"last_seen_date" date NOT NULL,
	"thumbnail_key" text,
	"parsed" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" text PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "news_feeds" (
	"id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_feeds_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "news_items" (
	"id" text PRIMARY KEY NOT NULL,
	"feed_id" text NOT NULL,
	"title" text NOT NULL,
	"link" text NOT NULL,
	"published_at" timestamp with time zone,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"landing_domain" text PRIMARY KEY NOT NULL,
	"page_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"first_seen_date" date NOT NULL,
	"last_seen_date" date NOT NULL,
	"running_ads" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "store_members" ADD CONSTRAINT "store_members_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_members" ADD CONSTRAINT "store_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_run_id_crawl_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_briefing_id_briefings_id_fk" FOREIGN KEY ("briefing_id") REFERENCES "public"."briefings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lark_messages" ADD CONSTRAINT "lark_messages_briefing_id_briefings_id_fk" FOREIGN KEY ("briefing_id") REFERENCES "public"."briefings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_briefing_id_briefings_id_fk" FOREIGN KEY ("briefing_id") REFERENCES "public"."briefings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_searches" ADD CONSTRAINT "crawl_searches_run_id_crawl_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_searches" ADD CONSTRAINT "crawl_searches_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_days" ADD CONSTRAINT "keyword_days_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_time_changes" ADD CONSTRAINT "run_time_changes_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_keywords" ADD CONSTRAINT "store_keywords_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_keywords" ADD CONSTRAINT "store_keywords_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_ideas" ADD CONSTRAINT "saved_ideas_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_ideas" ADD CONSTRAINT "saved_ideas_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_ideas" ADD CONSTRAINT "saved_ideas_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_sightings" ADD CONSTRAINT "ad_sightings_ad_archive_id_ads_ad_archive_id_fk" FOREIGN KEY ("ad_archive_id") REFERENCES "public"."ads"("ad_archive_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_sightings" ADD CONSTRAINT "ad_sightings_run_id_crawl_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_sightings" ADD CONSTRAINT "ad_sightings_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_feed_id_news_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."news_feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_run_kind_key" ON "alerts" USING btree ("run_id","kind") WHERE "alerts"."kind" in ('blocked', 'parse_error', 'missed_run', 'run_failed');--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_network_cooldown_key" ON "alerts" USING btree ("run_id","cooldown_seq") WHERE "alerts"."kind" = 'network_error';--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_open_heartbeat_key" ON "alerts" USING btree ("kind") WHERE "alerts"."kind" = 'heartbeat_lost' and "alerts"."resolved_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_briefing_kind_key" ON "alerts" USING btree ("briefing_id","kind") WHERE "alerts"."kind" in ('briefing_late', 'lark_send_failed');--> statement-breakpoint
CREATE UNIQUE INDEX "lark_messages_briefing_chat_key" ON "lark_messages" USING btree ("briefing_id","chat");--> statement-breakpoint
CREATE UNIQUE INDEX "crawl_runs_slot_key" ON "crawl_runs" USING btree ("source","scheduled_for") WHERE "crawl_runs"."trigger" = 'schedule';--> statement-breakpoint
CREATE UNIQUE INDEX "crawl_runs_one_manual_key" ON "crawl_runs" USING btree ("source") WHERE "crawl_runs"."trigger" in ('manual', 'cli') and "crawl_runs"."status" in ('scheduled', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "crawl_searches_pair_key" ON "crawl_searches" USING btree ("run_id","keyword_id","country");--> statement-breakpoint
CREATE UNIQUE INDEX "keywords_text_key" ON "keywords" USING btree (lower("text"));--> statement-breakpoint
CREATE UNIQUE INDEX "saved_ideas_source_key" ON "saved_ideas" USING btree ("store_id","source","source_ref");--> statement-breakpoint
CREATE INDEX "saved_ideas_store_status_idx" ON "saved_ideas" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "ad_sightings_crawl_day_idx" ON "ad_sightings" USING btree ("crawl_day");--> statement-breakpoint
CREATE INDEX "ad_sightings_pair_idx" ON "ad_sightings" USING btree ("keyword_id","country");--> statement-breakpoint
CREATE INDEX "ads_caption_trgm" ON "ads" USING gin ("caption" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ads_page_name_trgm" ON "ads" USING gin ("page_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ads_landing_domain_trgm" ON "ads" USING gin ("landing_domain" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ads_last_seen_idx" ON "ads" USING btree ("last_seen_date");--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_date_name_key" ON "holidays" USING btree ("date","name");--> statement-breakpoint
CREATE UNIQUE INDEX "news_items_link_key" ON "news_items" USING btree ("feed_id","link");--> statement-breakpoint
-- Default settings: DEFAULT_SETTINGS in packages/core/src/settings.ts (src/migration.test.ts checks they agree).
INSERT INTO "settings" ("key", "value") VALUES
  ('countries', '["US","GB","CA","AU"]'),
  ('runTimes', '["01:00","13:00"]'),
  ('runDeadlineMinutes', '270'),
  ('morningHardStop', '"06:05"'),
  ('manualRunMarginMinutes', '25'),
  ('watchdogGraceMinutes', '15'),
  ('searchBudget', '160'),
  ('maxKeywords', '80'),
  ('adsPerSearchCap', '100'),
  ('noNewAdsPagesToStop', '2'),
  ('searchGapSeconds', '{"min":20,"max":60}'),
  ('pageDelayMs', '{"min":400,"max":1300}'),
  ('scrollDelayMs', '{"min":900,"max":1700}'),
  ('backoff', '{"baseSeconds":45,"jitter":0.15,"quietMinutes":30,"stopBlockStreak":3,"stopBlockedSearches":6}'),
  ('attemptsPerSearch', '3'),
  ('retryDelaysSeconds', '[5,15]'),
  ('networkCooldown', '{"streak":3,"minutes":10}'),
  ('waitLimitsSeconds', '{"browserStart":60,"pageLoad":60,"embeddedData":15,"scrollResponse":15,"thumbnailDownload":15,"browserClose":15}'),
  ('blockEmptyPayloadsInRow', '3'),
  ('cooldownHours', '6'),
  ('staleAfterDays', '3'),
  ('heartbeatThresholdMinutes', '30'),
  ('missedRunGraceMinutes', '15'),
  ('briefingBuildTime', '"06:30"'),
  ('briefingReadyTime', '"07:00"'),
  ('briefingJobExpirySeconds', '900'),
  ('llmCallTimeoutSeconds', '120'),
  ('larkSendTimeoutSeconds', '30'),
  ('browserProfile', 'null'),
  ('proxy', 'null'),
  ('aiDailyCostCapUsd', '3'),
  ('llmModel', '"claude-sonnet-5-5"');
--> statement-breakpoint
-- The default run times, effective from install.
INSERT INTO "run_time_changes" ("id", "run_times", "effective_from") VALUES ('rtc_initial', '["01:00","13:00"]', now());--> statement-breakpoint
INSERT INTO "crawler_state" ("id") VALUES (1);
