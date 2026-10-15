import "server-only";

import { sql } from "drizzle-orm";

import { TZ, dayEnd, dayStart } from "@/lib/tz";

import { db } from "./db/client";
import { hackatimeDays, ships, users } from "./db/schema";
import { siteVisitors } from "./vercel-analytics";

// Everything here is aggregate: the stats page is public, so nothing in this
// module may return a name, email, Slack ID or anything else about one person.

// Top of the funnel comes from Vercel Web Analytics; STATS_VISITORS is the
// number shown until that's configured (or when Vercel can't be reached).
const VISITORS_FALLBACK = Number(process.env.STATS_VISITORS) || 540;

export type Funnel = {
  visitors: number;
  signedUp: number; // every user row, including Slack "join" placeholders
  linked: number; // linked a Hackatime account
  onboarded: number; // finished /welcome
  active: number; // logged HTML time on Hackatime during the program
  shipped: number; // at least one ship
  approved: number; // at least one approved ship
};

export type Overview = {
  people: number; // every row, including Slack "join" placeholders
  signedUp: number;
  onboarded: number;
  hackatimeLinked: number;
  eligible: number;
  ships: { total: number; pending: number; approved: number; rejected: number; reships: number };
  seconds: { claimed: number; awarded: number; avgApproved: number | null };
  badges: { slug: string; claimed: number; awarded: number }[];
  reviewMedianMinutes: number | null;
};

export type Referrals = {
  links: number; // people who took the pledge and got a link
  signedUp: number; // signed in through someone's link
  shipped: number;
  approved: number;
};

export async function funnel(): Promise<Funnel> {
  const [visitors, [u], [a], [s]] = await Promise.all([
    siteVisitors(),
    db
      .select({
        signedUp: sql<number>`count(*)::int`,
        linked: sql<number>`(count(*) filter (where ${users.hackatimeAccountId} is not null))::int`,
        onboarded: sql<number>`(count(*) filter (where ${users.onboardedAt} is not null))::int`,
      })
      .from(users),
    db
      .select({ active: sql<number>`(count(distinct ${hackatimeDays.userId}) filter (where ${hackatimeDays.shrinkSeconds} > 0))::int` })
      .from(hackatimeDays),
    db
      .select({
        shipped: sql<number>`count(distinct ${ships.userId})::int`,
        approved: sql<number>`(count(distinct ${ships.userId}) filter (where ${ships.state} = 'approved'))::int`,
      })
      .from(ships),
  ]);
  return {
    visitors: visitors ?? VISITORS_FALLBACK,
    signedUp: u?.signedUp ?? 0,
    linked: u?.linked ?? 0,
    onboarded: u?.onboarded ?? 0,
    active: a?.active ?? 0,
    shipped: s?.shipped ?? 0,
    approved: s?.approved ?? 0,
  };
}

export async function overview(): Promise<Overview> {
  const [[u], [s], badges] = await Promise.all([
    db
      .select({
        people: sql<number>`count(*)::int`,
        signedUp: sql<number>`(count(*) filter (where ${users.hcaSubject} is not null))::int`,
        onboarded: sql<number>`(count(*) filter (where ${users.onboardedAt} is not null))::int`,
        hackatimeLinked: sql<number>`(count(*) filter (where ${users.hackatimeAccountId} is not null))::int`,
        eligible: sql<number>`(count(*) filter (where ${users.eligibility} = 'eligible'))::int`,
      })
      .from(users),
    db
      .select({
        total: sql<number>`count(*)::int`,
        pending: sql<number>`(count(*) filter (where ${ships.state} = 'pending'))::int`,
        approved: sql<number>`(count(*) filter (where ${ships.state} = 'approved'))::int`,
        rejected: sql<number>`(count(*) filter (where ${ships.state} = 'rejected'))::int`,
        reships: sql<number>`(count(*) filter (where ${ships.reshipOf} is not null))::int`,
        claimed: sql<number>`coalesce(sum(${ships.claimedSeconds}) filter (where ${ships.state} <> 'rejected'), 0)::bigint`,
        awarded: sql<number>`coalesce(sum(${ships.awardedSeconds}) filter (where ${ships.state} = 'approved'), 0)::bigint`,
        avgApproved: sql<number | null>`avg(${ships.awardedSeconds}) filter (where ${ships.state} = 'approved')`,
        reviewMedian: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (${ships.reviewedAt} - ${ships.createdAt})) / 60) filter (where ${ships.reviewedAt} is not null)`,
      })
      .from(ships),
    db.execute(sql`
      select slug,
             count(*) filter (where kind = 'claimed')::int as claimed,
             count(*) filter (where kind = 'awarded')::int as awarded
      from (
        select unnest(${ships.claimedBadges}) as slug, 'claimed' as kind from ${ships} where ${ships.state} <> 'rejected'
        union all
        select unnest(${ships.awardedBadges}) as slug, 'awarded' as kind from ${ships} where ${ships.state} = 'approved'
      ) b
      group by slug
      order by awarded desc, claimed desc
    `) as Promise<{ slug: string; claimed: number; awarded: number }[]>,
  ]);
  return {
    people: u?.people ?? 0,
    signedUp: u?.signedUp ?? 0,
    onboarded: u?.onboarded ?? 0,
    hackatimeLinked: u?.hackatimeLinked ?? 0,
    eligible: u?.eligible ?? 0,
    ships: {
      total: s?.total ?? 0,
      pending: s?.pending ?? 0,
      approved: s?.approved ?? 0,
      rejected: s?.rejected ?? 0,
      reships: s?.reships ?? 0,
    },
    seconds: {
      claimed: Number(s?.claimed ?? 0),
      awarded: Number(s?.awarded ?? 0),
      avgApproved: s?.avgApproved == null ? null : Number(s.avgApproved),
    },
    badges: badges.map((b) => ({ slug: b.slug, claimed: Number(b.claimed), awarded: Number(b.awarded) })),
    reviewMedianMinutes: s?.reviewMedian == null ? null : Math.round(Number(s.reviewMedian)),
  };
}

export type DayCounts = { day: string; signups: number; onboarded: number; ships: number; approved: number };

// Per Vermont day over `days`: new sign-ins, finished onboardings, ships, approvals.
export async function dailyCounts(days: string[]): Promise<DayCounts[]> {
  if (days.length === 0) return [];
  const from = dayStart(days[0]).toISOString();
  const to = dayEnd(days[days.length - 1]).toISOString();
  const dayOf = (col: unknown) => sql<string>`to_char(${col} at time zone ${sql.raw(`'${TZ}'`)}, 'YYYY-MM-DD')`;
  const [signups, onboarded, shipped, approved] = await Promise.all([
    db
      .select({ day: dayOf(users.createdAt), n: sql<number>`count(*)::int` })
      .from(users)
      .where(sql`${users.hcaSubject} is not null and ${users.createdAt} between ${from}::timestamptz and ${to}::timestamptz`)
      .groupBy(dayOf(users.createdAt)),
    db
      .select({ day: dayOf(users.onboardedAt), n: sql<number>`count(*)::int` })
      .from(users)
      .where(sql`${users.onboardedAt} between ${from}::timestamptz and ${to}::timestamptz`)
      .groupBy(dayOf(users.onboardedAt)),
    db
      .select({ day: dayOf(ships.createdAt), n: sql<number>`count(*)::int` })
      .from(ships)
      .where(sql`${ships.createdAt} between ${from}::timestamptz and ${to}::timestamptz`)
      .groupBy(dayOf(ships.createdAt)),
    db
      .select({ day: dayOf(ships.reviewedAt), n: sql<number>`count(*)::int` })
      .from(ships)
      .where(sql`${ships.state} = 'approved' and ${ships.reviewedAt} between ${from}::timestamptz and ${to}::timestamptz`)
      .groupBy(dayOf(ships.reviewedAt)),
  ]);
  const pick = (rows: { day: string; n: number }[]) => new Map(rows.map((r) => [r.day, r.n]));
  const [S, O, H, A] = [pick(signups), pick(onboarded), pick(shipped), pick(approved)];
  return days.map((day) => ({
    day,
    signups: S.get(day) ?? 0,
    onboarded: O.get(day) ?? 0,
    ships: H.get(day) ?? 0,
    approved: A.get(day) ?? 0,
  }));
}

export async function referrals(): Promise<Referrals> {
  const [row] = (await db.execute(sql`
    select
      (select count(*) from ${users} where ${users.referralCode} is not null)::int as links,
      (select count(*) from ${users} where ${users.referredById} is not null and ${users.hcaSubject} is not null)::int as signed_up,
      (select count(distinct s.user_id) from ${ships} s join ${users} r on r.id = s.user_id where r.referred_by_id is not null)::int as shipped,
      (select count(distinct s.user_id) from ${ships} s join ${users} r on r.id = s.user_id where r.referred_by_id is not null and s.state = 'approved')::int as approved
  `)) as { links: number; signed_up: number; shipped: number; approved: number }[];
  return {
    links: Number(row?.links ?? 0),
    signedUp: Number(row?.signed_up ?? 0),
    shipped: Number(row?.shipped ?? 0),
    approved: Number(row?.approved ?? 0),
  };
}

export type ReviewStats = {
  decisions: number;
  approved: number; // calls, landed or held
  sentBack: number;
  reviewers: number; // how many people have made a call, never who
  lastWeek: number;
  queue: number; // pending with no call yet
  secondPass: number; // a call waiting on an admin
  oldestWaitingMinutes: number | null;
  medianWaitMinutes: number | null; // ship to first call
  p90WaitMinutes: number | null;
  medianDeskMs: number | null; // active desk time on a ship, by whoever decided it
  checkPassed: number;
  checkFailed: number;
  // Over approval calls: what was claimed vs. what the reviewer gave.
  approvedClaimedSeconds: number;
  deflatedSeconds: number;
  queueSeconds: number; // claimed time on ships still in the queue
  daily: { day: string; approved: number; sentBack: number }[];
};

// The review desk in aggregate. A ship's call is its first one, the reviewer's,
// held or landed, the same way the audit counts it (lib/server/audit.ts).
export async function reviewStats(days: string[]): Promise<ReviewStats> {
  const dayOf = sql.raw(`to_char(decided_at at time zone '${TZ}', 'YYYY-MM-DD')`);
  const from = days.length ? dayStart(days[0]).toISOString() : new Date(0).toISOString();
  const decisions = sql`
    select s.id, s.created_at,
      case when s.state = 'rejected' then s.reviewer_id else coalesce(s.verdict->>'reviewerId', s.reviewer_id) end as decider,
      case when s.state = 'rejected' then s.reviewed_at else coalesce((s.verdict->>'at')::timestamptz, s.reviewed_at) end as decided_at,
      s.state = 'rejected' or coalesce(s.verdict->>'kind' = 'reject', false) as sent_back,
      s.claimed_seconds,
      coalesce(s.awarded_seconds, (s.verdict->>'awardedSeconds')::bigint) as awarded_seconds
    from ${ships} s
    where s.state <> 'pending' or s.verdict is not null`;
  const [[d], [q], daily] = await Promise.all([
    db.execute(sql`
      with d as (${decisions}),
      desk as (
        select coalesce(sum(a.active_ms), 0) as ms
        from d join review_activity a on a.ship_id = d.id and a.user_id = d.decider
        group by d.id
      )
      select
        count(*)::int as decisions,
        (count(*) filter (where not sent_back))::int as approved,
        (count(*) filter (where sent_back))::int as sent_back,
        count(distinct decider)::int as reviewers,
        (count(*) filter (where decided_at >= now() - interval '7 days'))::int as last_week,
        percentile_cont(0.5) within group (order by extract(epoch from (decided_at - created_at)) / 60) as median_wait,
        percentile_cont(0.9) within group (order by extract(epoch from (decided_at - created_at)) / 60) as p90_wait,
        (select percentile_cont(0.5) within group (order by ms) from desk where ms > 0) as median_desk,
        coalesce(sum(claimed_seconds) filter (where not sent_back), 0)::bigint as approved_claimed,
        coalesce(sum(greatest(claimed_seconds - awarded_seconds, 0)) filter (where not sent_back), 0)::bigint as deflated
      from d
    `) as Promise<Record<string, unknown>[]>,
    db.execute(sql`
      select
        (count(*) filter (where ${ships.state} = 'pending' and ${ships.verdict} is null))::int as queue,
        (count(*) filter (where ${ships.state} = 'pending' and ${ships.verdict} is not null and ${ships.verdict}->>'confirmedBy' is null))::int as second_pass,
        coalesce(sum(${ships.claimedSeconds}) filter (where ${ships.state} = 'pending' and ${ships.verdict} is null), 0)::bigint as queue_seconds,
        extract(epoch from (now() - min(${ships.createdAt}) filter (where ${ships.state} = 'pending' and ${ships.verdict} is null))) / 60 as oldest,
        (count(*) filter (where ${ships.secondaryState} = 'passed'))::int as passed,
        (count(*) filter (where ${ships.secondaryState} = 'failed'))::int as failed
      from ${ships}
    `) as Promise<Record<string, unknown>[]>,
    db.execute(sql`
      with d as (${decisions})
      select ${dayOf} as day,
        (count(*) filter (where not sent_back))::int as approved,
        (count(*) filter (where sent_back))::int as sent_back
      from d where decided_at >= ${from}::timestamptz
      group by 1
    `) as Promise<{ day: string; approved: number; sent_back: number }[]>,
  ]);
  const num = (v: unknown) => (v == null ? null : Number(v));
  const mins = (v: unknown) => (v == null ? null : Math.round(Number(v)));
  const byDay = new Map(daily.map((r) => [r.day, r]));
  return {
    decisions: Number(d?.decisions ?? 0),
    approved: Number(d?.approved ?? 0),
    sentBack: Number(d?.sent_back ?? 0),
    reviewers: Number(d?.reviewers ?? 0),
    lastWeek: Number(d?.last_week ?? 0),
    queue: Number(q?.queue ?? 0),
    secondPass: Number(q?.second_pass ?? 0),
    oldestWaitingMinutes: mins(q?.oldest),
    medianWaitMinutes: mins(d?.median_wait),
    p90WaitMinutes: mins(d?.p90_wait),
    medianDeskMs: num(d?.median_desk),
    checkPassed: Number(q?.passed ?? 0),
    checkFailed: Number(q?.failed ?? 0),
    approvedClaimedSeconds: Number(d?.approved_claimed ?? 0),
    deflatedSeconds: Number(d?.deflated ?? 0),
    queueSeconds: Number(q?.queue_seconds ?? 0),
    daily: days.map((day) => ({
      day,
      approved: Number(byDay.get(day)?.approved ?? 0),
      sentBack: Number(byDay.get(day)?.sent_back ?? 0),
    })),
  };
}
