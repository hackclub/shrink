ALTER TABLE "ships" ADD COLUMN "ysws_filed_at" timestamp with time zone;--> statement-breakpoint
-- Everything approved so far is already in the YSWS table.
UPDATE "ships" SET "ysws_filed_at" = now() WHERE "state" = 'approved';
