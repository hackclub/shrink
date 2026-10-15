CREATE TABLE "replay_chunks" (
	"session_id" text NOT NULL,
	"seq" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"events" integer NOT NULL,
	"first_ts" bigint,
	"last_ts" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "replay_chunks_session_id_seq_pk" PRIMARY KEY("session_id","seq")
);
--> statement-breakpoint
CREATE TABLE "replay_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"user_agent" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_chunk_at" timestamp with time zone DEFAULT now() NOT NULL,
	"chunks" integer DEFAULT 0 NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"ended_at" timestamp with time zone,
	"error" text,
	"error_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review_activity" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"seq" integer NOT NULL,
	"ship_id" text,
	"active_ms" integer NOT NULL,
	"from_at" timestamp with time zone NOT NULL,
	"to_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN "replay_id" text;--> statement-breakpoint
ALTER TABLE "replay_chunks" ADD CONSTRAINT "replay_chunks_session_id_replay_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."replay_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replay_sessions" ADD CONSTRAINT "replay_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_activity" ADD CONSTRAINT "review_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_activity" ADD CONSTRAINT "review_activity_session_id_replay_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."replay_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "replay_sessions_user_idx" ON "replay_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "replay_sessions_started_idx" ON "replay_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "review_activity_user_idx" ON "review_activity" USING btree ("user_id","from_at");--> statement-breakpoint
CREATE INDEX "review_activity_ship_idx" ON "review_activity" USING btree ("ship_id");--> statement-breakpoint
CREATE INDEX "review_activity_session_idx" ON "review_activity" USING btree ("session_id","seq");