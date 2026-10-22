CREATE TABLE "page_days" (
	"page_id" text NOT NULL,
	"crawl_day" date NOT NULL,
	"like_count" integer NOT NULL,
	CONSTRAINT "page_days_page_id_crawl_day_pk" PRIMARY KEY("page_id","crawl_day")
);
