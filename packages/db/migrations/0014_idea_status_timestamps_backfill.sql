UPDATE "saved_ideas" SET "picked_at" = "updated_at" WHERE "status" IN ('picked', 'done');--> statement-breakpoint
UPDATE "saved_ideas" SET "done_at" = "updated_at" WHERE "status" = 'done';
