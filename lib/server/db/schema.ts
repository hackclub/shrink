import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { Check } from "@/lib/scan";

const id = () =>
  text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`);
const now = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum("role", ["participant", "reviewer", "admin"]);
export const shipStateEnum = pgEnum("ship_state", ["pending", "approved", "rejected"]);
export const orderStateEnum = pgEnum("order_state", ["placed", "fulfilled", "rejected"]);
export const entryTypeEnum = pgEnum("entry_type", ["award", "order", "refund", "adjustment"]);

export const users = pgTable(
  "users",
  {
    id: id(),
    // Null until the person signs in with Hack Club Auth; people who hit "join"
    // in Slack get a row first, keyed by slackId.
    hcaSubject: text("hca_subject"),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    slackId: text("slack_id"),
    verificationStatus: text("verification_status"),
    eligibility: text("eligibility").notNull().default("undetermined"),
    eligibilityAt: timestamp("eligibility_at", { withTimezone: true }),
    birthdate: text("birthdate"),
    role: roleEnum("role").notNull().default("participant"),
    hcaTokenEncrypted: text("hca_token_encrypted"),
    hcaTokenExpiresAt: timestamp("hca_token_expires_at", { withTimezone: true }),
    hackatimeAccountId: text("hackatime_account_id"),
    hackatimeTokenEncrypted: text("hackatime_token_encrypted"),
    hackatimeLinkedAt: timestamp("hackatime_linked_at", { withTimezone: true }),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    // Null until they type out the no-spam pledge on /app/invite.
    referralCode: text("referral_code"),
    // Set only when the row is created from a sign-in that came through someone's link.
    referredById: text("referred_by_id"),
    // An admin pulled their link for spamming: it stops working and pays nothing more.
    referralRevokedAt: timestamp("referral_revoked_at", { withTimezone: true }),
    createdAt: now("created_at"),
    lastSeenAt: now("last_seen_at"),
  },
  (t) => [
    uniqueIndex("users_hca_subject_idx").on(t.hcaSubject),
    index("users_email_idx").on(t.email),
    uniqueIndex("users_hackatime_account_idx").on(t.hackatimeAccountId),
    uniqueIndex("users_referral_code_idx").on(t.referralCode),
    index("users_referred_by_idx").on(t.referredById),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: now("created_at"),
  },
  (t) => [uniqueIndex("sessions_token_hash_idx").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  // Which callback may consume it, so an HCA state can't finish a Hackatime link.
  purpose: text("purpose").notNull().default("hca"),
  userId: text("user_id"),
  codeVerifier: text("code_verifier").notNull(),
  redirectTo: text("redirect_to"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: now("created_at"),
});

export const ships = pgTable(
  "ships",
  {
    id: id(),
    number: integer("number").generatedAlwaysAsIdentity(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    description: text("description").notNull(),
    dataUri: text("data_uri").notNull(),
    bytes: integer("bytes").notNull(),
    sourceUrl: text("source_url"),
    hackatimeProjects: text("hackatime_projects").array().notNull(),
    claimedSeconds: bigint("claimed_seconds", { mode: "number" }).notNull(),
    claimedBadges: text("claimed_badges").array().notNull().default([]),
    reshipOf: text("reship_of"),
    scan: jsonb("scan").$type<Check[]>(),

    state: shipStateEnum("state").notNull().default("pending"),
    reviewerId: text("reviewer_id").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    awardedSeconds: bigint("awarded_seconds", { mode: "number" }),
    awardedBadges: text("awarded_badges").array(),
    awardedBites: integer("awarded_bites"),
    publicMessage: text("public_message"),
    // Never shown to the author.
    internalNote: text("internal_note"),
    // A reviewer's approval, held until the secondary check passes. The ship stays
    // pending (and the author sees one review) until both are in.
    verdict: jsonb("verdict").$type<Verdict>(),
    // The secondary check (lib/server/secondary.ts). Null state means not sent yet.
    secondaryId: text("secondary_id"),
    secondaryState: text("secondary_state").$type<"waiting" | "passed" | "failed">(),
    secondaryScore: integer("secondary_score"),
    secondaryNote: text("secondary_note"),
    secondarySeconds: bigint("secondary_seconds", { mode: "number" }),
    secondaryAt: timestamp("secondary_at", { withTimezone: true }),
    // The reviewer who has this ship open, so two people don't review it at once.
    // Lapses if their tab stops renewing it; see claim() in lib/server/ships.ts.
    claimedBy: text("claimed_by").references(() => users.id),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    // The desk recording (replay_sessions) the decision was made in.
    replayId: text("replay_id"),
    createdAt: now("created_at"),
  },
  (t) => [
    index("ships_user_idx").on(t.userId),
    index("ships_state_idx").on(t.state, t.createdAt),
    uniqueIndex("ships_number_idx").on(t.number),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    amount: integer("amount").notNull(),
    type: entryTypeEnum("type").notNull(),
    reason: text("reason").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    actorId: text("actor_id"),
    createdAt: now("created_at"),
  },
  (t) => [uniqueIndex("ledger_key_idx").on(t.idempotencyKey), index("ledger_user_idx").on(t.userId)],
);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    number: integer("number").generatedAlwaysAsIdentity(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    rewardSlug: text("reward_slug").notNull(),
    rewardName: text("reward_name").notNull(),
    cost: integer("cost").notNull(),
    state: orderStateEnum("state").notNull().default("placed"),
    shippingEncrypted: text("shipping_encrypted"),
    note: text("note"),
    handledBy: text("handled_by").references(() => users.id),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    internalNote: text("internal_note"),
    createdAt: now("created_at"),
  },
  (t) => [index("orders_user_idx").on(t.userId), index("orders_state_idx").on(t.state, t.createdAt)],
);

export const auditEvents = pgTable("audit_events", {
  id: id(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  subject: text("subject"),
  detail: jsonb("detail"),
  createdAt: now("created_at"),
});

export const rateHits = pgTable(
  "rate_hits",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bucket: text("bucket").notNull(),
    createdAt: now("created_at"),
  },
  (t) => [index("rate_hits_user_bucket_idx").on(t.userId, t.bucket, t.createdAt)],
);

// Pre-ship scan results keyed by repo commit, so re-scans of an unchanged repo
// skip GitHub and the LLM.
export const scanCache = pgTable("scan_cache", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  createdAt: now("created_at"),
});

// One row per person per Vermont day of Hackatime activity. `shrinkSeconds` is the
// time on projects that pass the SHRINK check (see lib/server/activity.ts);
// it's recomputed from hackatime_projects after every refresh.
export const hackatimeDays = pgTable(
  "hackatime_days",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    totalSeconds: integer("total_seconds").notNull().default(0),
    shrinkSeconds: integer("html_seconds").notNull().default(0),
    languages: jsonb("languages").$type<{ name: string; seconds: number }[]>().notNull().default([]),
    projects: jsonb("projects").$type<{ name: string; seconds: number }[]>().notNull().default([]),
    fetchedAt: now("fetched_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] }), index("hackatime_days_day_idx").on(t.day)],
);

// What each Hackatime project looked like on each day: how long, whether any
// HTML was touched, and which files or languages a SHRINK app shouldn't have.
// A project is a SHRINK project only if, over every day we've seen, it has
// HTML and no offenders.
export const hackatimeProjects = pgTable(
  "hackatime_projects",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    project: text("project").notNull(),
    seconds: integer("seconds").notNull().default(0),
    hasHtml: boolean("has_html").notNull().default(false),
    offenders: text("offenders").array().notNull().default([]),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day, t.project] }), index("hackatime_projects_user_idx").on(t.userId, t.project)],
);

// Seconds a project had on Hackatime before the SHRINK cutoff, checked once
// per (person, project). Anything above zero means the project predates SHRINK.
export const hackatimeProjectHistory = pgTable(
  "hackatime_project_history",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    project: text("project").notNull(),
    beforeSeconds: integer("before_seconds").notNull().default(0),
    checkedAt: now("checked_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.project] })],
);

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

// rrweb recordings of the review desk, one row per tab. The client makes the id and
// uploads numbered chunks; a missing seq is a gap, and no endedAt means the tab was cut off.
export const replaySessions = pgTable(
  "replay_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userAgent: text("user_agent"),
    startedAt: now("started_at"),
    lastChunkAt: now("last_chunk_at"),
    chunks: integer("chunks").notNull().default(0),
    bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    // The last thing that went wrong on the client (recorder crash, failed uploads), as it reported it.
    error: text("error"),
    errorAt: timestamp("error_at", { withTimezone: true }),
  },
  (t) => [index("replay_sessions_user_idx").on(t.userId, t.startedAt), index("replay_sessions_started_idx").on(t.startedAt)],
);

// Gzipped JSON arrays of rrweb events. firstTs/lastTs are the event timestamps (ms).
export const replayChunks = pgTable(
  "replay_chunks",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => replaySessions.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    data: bytea("data").notNull(),
    events: integer("events").notNull(),
    firstTs: bigint("first_ts", { mode: "number" }),
    lastTs: bigint("last_ts", { mode: "number" }),
    createdAt: now("created_at"),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.seq] })],
);

// Active time on the review desk, as the recorder measured it: gaps between
// interactions shorter than the idle cutoff, credited to the ship open for review
// (null when none was). Pulled out of replay chunks as they land, so each chunk's
// rows are written exactly once.
export const reviewActivity = pgTable(
  "review_activity",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => replaySessions.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    shipId: text("ship_id"),
    activeMs: integer("active_ms").notNull(),
    // When the credited span started and ended, by the reviewer's clock.
    fromAt: timestamp("from_at", { withTimezone: true }).notNull(),
    toAt: timestamp("to_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("review_activity_user_idx").on(t.userId, t.fromAt),
    index("review_activity_ship_idx").on(t.shipId),
    index("review_activity_session_idx").on(t.sessionId, t.seq),
  ],
);

export type Verdict = {
  reviewerId: string;
  at: string;
  awardedSeconds: number;
  badges: string[];
  bites: number;
  message: string;
  internalNote: string | null;
};

export type User = typeof users.$inferSelect;
export type HackatimeDay = typeof hackatimeDays.$inferSelect;
export type Ship = typeof ships.$inferSelect;
export type ReplaySession = typeof replaySessions.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
