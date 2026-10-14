ALTER TABLE "ships" ADD COLUMN "claimed_by" text;--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ships" ADD CONSTRAINT "ships_claimed_by_users_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;