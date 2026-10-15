import "server-only";

import { sql } from "drizzle-orm";

import { FAST_REVIEW_MS } from "@/lib/review-time";

import { db } from "./db/client";

// The review audit (app/(platform)/admin/audit). A decision belongs to whoever made
// the call: the reviewer of a held or landed call (verdict), or whoever sent it back.
// An admin's second pass leaves the call the reviewer's, even one they changed.
// Time is active time from review_activity (see lib/review-time.ts).

export const RANGES = { "7d": 7, "30d": 30, "90d": 90, all: null } as const;
export type Range = keyof typeof RANGES;
export const parseRange = (r: string | undefined): Range => (r && r in RANGES ? (r as Range) : "30d");
// Where a range starts, or undefined for all time.
export const rangeStart = (r: Range): Date | undefined => (RANGES[r] === null ? undefined : new Date(Date.now() - RANGES[r]! * 86_400_000));
// Raw sql params go to postgres-js as-is, and it won't take a Date.
const at = (d: Date) => sql`${d.toISOString()}::timestamptz`;
const since = (r: Range) => (RANGES[r] === null ? new Date(0) : new Date(Date.now() - RANGES[r]! * 86_400_000));

const DECISIONS = sql`
  select
    s.id as ship_id,
    case when s.state = 'rejected' then s.reviewer_id else coalesce(s.verdict->>'reviewerId', s.reviewer_id) end as decider,
    case when s.state = 'rejected' then s.reviewed_at else coalesce((s.verdict->>'at')::timestamptz, s.reviewed_at) end as decided_at,
    case when s.state = 'rejected' then 'sent back' when s.state = 'approved' then 'approved'
      when s.verdict->>'kind' = 'reject' then 'sent back, held' else 'approved, held' end as kind
  from ships s
  where s.state <> 'pending' or s.verdict is not null`;

export type ReviewerSummary = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
  decisions: number;
  approved: number;
  sentBack: number;
  // Active time on the ships they decided, all of it (not just in range).
  reviewMs: number;
  medianMs: number;
  fast: number;
  unrecorded: number;
  // All active desk time in range, decided or not, on a ship or not.
  activeMs: number;
  lastActive: Date | null;
  sessions: number;
  brokenSessions: number;
};

export async function reviewerSummaries(range: Range): Promise<ReviewerSummary[]> {
  const from = since(range);
  const rows = await db.execute<Record<string, unknown>>(sql`
    with d as (${DECISIONS}),
    dr as (
      select d.*, s.replay_id,
        coalesce((select sum(a.active_ms) from review_activity a where a.user_id = d.decider and a.ship_id = d.ship_id), 0) as ms
      from d join ships s on s.id = d.ship_id
      where d.decided_at >= ${at(from)}
    ),
    per as (
      select decider as id,
        count(*) as decisions,
        count(*) filter (where kind like 'approved%') as approved,
        count(*) filter (where kind like 'sent back%') as sent_back,
        sum(ms) as review_ms,
        percentile_cont(0.5) within group (order by ms) as median_ms,
        count(*) filter (where ms < ${FAST_REVIEW_MS}) as fast,
        -- Decisions from before the desk was recorded at all don't count against anyone.
        count(*) filter (where replay_id is null and decided_at > (select min(started_at) from replay_sessions)) as unrecorded
      from dr group by decider
    ),
    act as (
      select user_id as id, sum(active_ms) as active_ms, max(to_at) as last_active
      from review_activity where from_at >= ${at(from)} group by user_id
    ),
    sess as (
      select user_id as id, count(*) as sessions,
        count(*) filter (where chunks = 0
          or (ended_at is null and last_chunk_at < now() - interval '2 minutes')
          or chunks < coalesce((select max(seq) + 1 from replay_chunks c where c.session_id = replay_sessions.id), 0)) as broken
      from replay_sessions where started_at >= ${at(from)} group by user_id
    )
    select u.id, u.display_name, u.avatar_url, u.role,
      coalesce(per.decisions, 0) as decisions, coalesce(per.approved, 0) as approved, coalesce(per.sent_back, 0) as sent_back,
      coalesce(per.review_ms, 0) as review_ms, coalesce(per.median_ms, 0) as median_ms,
      coalesce(per.fast, 0) as fast, coalesce(per.unrecorded, 0) as unrecorded,
      coalesce(act.active_ms, 0) as active_ms, act.last_active,
      coalesce(sess.sessions, 0) as sessions, coalesce(sess.broken, 0) as broken
    from users u
    left join per on per.id = u.id
    left join act on act.id = u.id
    left join sess on sess.id = u.id
    where per.id is not null or act.id is not null or sess.id is not null
    order by coalesce(act.active_ms, 0) desc, coalesce(per.decisions, 0) desc
  `);
  return rows.map((r) => ({
    id: String(r.id),
    displayName: String(r.display_name),
    avatarUrl: (r.avatar_url as string | null) ?? null,
    role: String(r.role),
    decisions: Number(r.decisions),
    approved: Number(r.approved),
    sentBack: Number(r.sent_back),
    reviewMs: Number(r.review_ms),
    medianMs: Number(r.median_ms),
    fast: Number(r.fast),
    unrecorded: Number(r.unrecorded),
    activeMs: Number(r.active_ms),
    lastActive: r.last_active ? new Date(r.last_active as string) : null,
    sessions: Number(r.sessions),
    brokenSessions: Number(r.broken),
  }));
}

export type AuditDecision = {
  shipId: string;
  number: number;
  title: string;
  author: string;
  kind: "approved" | "approved, held" | "sent back" | "sent back, held";
  decidedAt: Date;
  claimedSeconds: number;
  awardedSeconds: number | null;
  bites: number | null;
  message: string | null;
  internalNote: string | null;
  replayId: string | null;
  ms: number;
  // Sessions this reviewer had the ship open in.
  sessions: number;
};

export async function reviewerDecisions(userId: string, range: Range): Promise<AuditDecision[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    with d as (${DECISIONS})
    select s.id, s.number, s.title, au.display_name as author, d.kind, d.decided_at, s.claimed_seconds,
      coalesce(s.awarded_seconds, (s.verdict->>'awardedSeconds')::bigint) as awarded_seconds,
      coalesce(s.awarded_bites, (s.verdict->>'bites')::int) as bites,
      coalesce(s.public_message, s.verdict->>'message') as message,
      coalesce(s.internal_note, s.verdict->>'internalNote') as internal_note,
      s.replay_id,
      coalesce(a.ms, 0) as ms, coalesce(a.sessions, 0) as sessions
    from d
    join ships s on s.id = d.ship_id
    join users au on au.id = s.user_id
    left join lateral (
      select sum(active_ms) as ms, count(distinct session_id) as sessions
      from review_activity where user_id = ${userId} and ship_id = s.id
    ) a on true
    where d.decider = ${userId} and d.decided_at >= ${at(since(range))}
    order by d.decided_at desc
  `);
  return rows.map((r) => ({
    shipId: String(r.id),
    number: Number(r.number),
    title: String(r.title),
    author: String(r.author),
    kind: r.kind as AuditDecision["kind"],
    decidedAt: new Date(r.decided_at as string),
    claimedSeconds: Number(r.claimed_seconds),
    awardedSeconds: r.awarded_seconds == null ? null : Number(r.awarded_seconds),
    bites: r.bites == null ? null : Number(r.bites),
    message: (r.message as string | null) ?? null,
    internalNote: (r.internal_note as string | null) ?? null,
    replayId: (r.replay_id as string | null) ?? null,
    ms: Number(r.ms),
    sessions: Number(r.sessions),
  }));
}

// Ships this reviewer spent time on in range but didn't decide: skipped, or decided by someone else.
export async function reviewerUndecided(userId: string, range: Range) {
  const rows = await db.execute<Record<string, unknown>>(sql`
    with d as (${DECISIONS})
    select s.id, s.number, s.title, s.state, sum(a.active_ms) as ms, max(a.to_at) as last_at,
      (select a2.session_id from review_activity a2 where a2.user_id = ${userId} and a2.ship_id = s.id order by a2.to_at desc limit 1) as session_id
    from review_activity a
    join ships s on s.id = a.ship_id
    left join d on d.ship_id = s.id
    where a.user_id = ${userId} and a.from_at >= ${at(since(range))} and (d.decider is null or d.decider <> ${userId})
    group by s.id
    order by max(a.to_at) desc
  `);
  return rows.map((r) => ({
    shipId: String(r.id),
    number: Number(r.number),
    title: String(r.title),
    state: String(r.state),
    ms: Number(r.ms),
    lastAt: new Date(r.last_at as string),
    sessionId: String(r.session_id),
  }));
}

// Active minutes per day (UTC), for the reviewer's activity strip.
export async function reviewerDaily(userId: string, range: Range): Promise<{ day: string; ms: number; reviewMs: number }[]> {
  const days = RANGES[range] ?? 90;
  const from = new Date(Date.now() - (days - 1) * 86_400_000);
  const rows = await db.execute<Record<string, unknown>>(sql`
    select to_char(date_trunc('day', from_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
      sum(active_ms) as ms, coalesce(sum(active_ms) filter (where ship_id is not null), 0) as review_ms
    from review_activity
    where user_id = ${userId} and from_at >= ${at(from)}
    group by 1
  `);
  const by = new Map(rows.map((r) => [String(r.day), { ms: Number(r.ms), reviewMs: Number(r.review_ms) }]));
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(from.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    return { day, ...(by.get(day) ?? { ms: 0, reviewMs: 0 }) };
  });
}

// Per-ship active time within one recording, for the player's sidebar.
export async function sessionShips(sessionId: string) {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select a.ship_id, s.number, s.title, sum(a.active_ms) as ms
    from review_activity a left join ships s on s.id = a.ship_id
    where a.session_id = ${sessionId}
    group by a.ship_id, s.number, s.title
  `);
  return rows.map((r) => ({
    shipId: (r.ship_id as string | null) ?? null,
    number: r.number == null ? null : Number(r.number),
    title: (r.title as string | null) ?? null,
    ms: Number(r.ms),
  }));
}
