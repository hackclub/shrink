import "server-only";

import { eq, inArray, sql, type Column } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { after } from "next/server";

import { BADGE_BY_SLUG, REWARD_BY_SLUG, hm } from "@/lib/program";
import type { Check } from "@/lib/scan";

import { fetchAddresses, normalizeAddress, type Address, type HcaAddress } from "./auth/hca";
import { decrypt } from "./crypto";
import { db } from "./db/client";
import { ledgerEntries, orders, ships, users, type Order, type User } from "./db/schema";
import { readAddress } from "./effects";
import { env, staging } from "./env";
import { requestOrigin } from "./origin";
import { STAGING_ADDRESS } from "./staging";
import { tokenBinding } from "./users";

// Users, Ships and Orders are mirrors: every sync overwrites them from Postgres, keyed on "ID".
// YSWS Project Submission is created once per approved ship and then left alone, because
// reviewers and the unified YSWS automation edit those records in Airtable.

type Fields = Record<string, unknown>;

const T = {
  users: () => env.AIRTABLE_USERS_TABLE,
  ships: () => env.AIRTABLE_SHIPS_TABLE,
  orders: () => env.AIRTABLE_ORDERS_TABLE,
  ysws: () => env.AIRTABLE_YSWS_TABLE,
};

export function airtableConfigured(): boolean {
  return Boolean(env.AIRTABLE_API_KEY && env.AIRTABLE_BASE_ID);
}

// Airtable allows 5 requests per second per base; space them out across concurrent syncs.
let gate = Promise.resolve();
function slot(): Promise<void> {
  const mine = gate.then(() => new Promise<void>((r) => setTimeout(r, 220)));
  gate = mine;
  return mine;
}

async function call<T>(method: string, table: string, body?: unknown, query = ""): Promise<T> {
  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}${query}`;
  for (let attempt = 0; ; attempt++) {
    await slot();
    const res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${env.AIRTABLE_API_KEY}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return (await res.json()) as T;
    // A 429 locks the base for 30 seconds.
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, res.status === 429 ? 30_000 : 2_000 * (attempt + 1)));
      continue;
    }
    throw new Error(`[airtable] ${method} ${table} ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
}

type Rec = { id: string; fields: Fields };

// Returns merge key -> Airtable record id.
async function upsert(table: string, records: Fields[], key: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (let i = 0; i < records.length; i += 10) {
    const res = await call<{ records: Rec[] }>("PATCH", table, {
      performUpsert: { fieldsToMergeOn: [key] },
      records: records.slice(i, i + 10).map((fields) => ({ fields })),
      typecast: true,
    });
    for (const r of res.records) ids.set(String(r.fields[key]), r.id);
  }
  return ids;
}

async function existingKeys(table: string, key: string): Promise<Set<string>> {
  const keys = new Set<string>();
  let offset: string | undefined;
  do {
    const q = new URLSearchParams({ pageSize: "100", "fields[]": key });
    if (offset) q.set("offset", offset);
    const res = await call<{ records: Rec[]; offset?: string }>("GET", table, undefined, `?${q}`);
    for (const r of res.records) if (r.fields[key]) keys.add(String(r.fields[key]));
    offset = res.offset;
  } while (offset);
  return keys;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const hours = (s: number | null | undefined) => (s == null ? null : Math.round((s / 3600) * 100) / 100);
const day = (d: Date) => d.toISOString().slice(0, 10);

function ageOn(birthdate: string | null, at = new Date()): number | null {
  const m = birthdate?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = at.getUTCFullYear() - y;
  if (at.getUTCMonth() + 1 < mo || (at.getUTCMonth() + 1 === mo && at.getUTCDate() < d)) age--;
  return age;
}

function githubUsername(url: string | null): string | null {
  return url?.match(/^https:\/\/(?:www\.)?github\.com\/([\w-]+)\//i)?.[1] ?? null;
}

function scanSummary(scan: Check[] | null): { result: string; text: string | null } {
  if (!scan?.length) return { result: "none", text: null };
  const ran = scan.filter((c) => c.status !== "skip");
  const result = ran.some((c) => c.status === "fail") ? "fail" : ran.some((c) => c.status === "warn") ? "warn" : "pass";
  const text = scan.map((c) => `${c.status.toUpperCase()}  ${c.label}${c.detail ? ` — ${c.detail}` : ""}`).join("\n");
  return { result, text };
}

// ---- loaders ---------------------------------------------------------------------------------

async function loadUsers(ids?: string[]) {
  if (ids && ids.length === 0) return [];
  const where = (col: Column) => (ids ? inArray(col, ids) : undefined);

  const [rows, ledger, shipStats, orderStats] = await Promise.all([
    db.select().from(users).where(where(users.id)),
    db
      .select({
        userId: ledgerEntries.userId,
        balance: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)::int`,
        earned: sql<number>`coalesce(sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.type} = 'award'), 0)::int`,
        spent: sql<number>`coalesce(-sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.type} = 'order'), 0)::int`,
        refunded: sql<number>`coalesce(sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.type} = 'refund'), 0)::int`,
        adjusted: sql<number>`coalesce(sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.type} = 'adjustment'), 0)::int`,
      })
      .from(ledgerEntries)
      .where(where(ledgerEntries.userId))
      .groupBy(ledgerEntries.userId),
    db
      .select({
        userId: ships.userId,
        total: sql<number>`count(*)::int`,
        pending: sql<number>`(count(*) filter (where ${ships.state} = 'pending'))::int`,
        approved: sql<number>`(count(*) filter (where ${ships.state} = 'approved'))::int`,
        rejected: sql<number>`(count(*) filter (where ${ships.state} = 'rejected'))::int`,
        claimed: sql<number>`coalesce(sum(${ships.claimedSeconds}) filter (where ${ships.state} <> 'rejected'), 0)::bigint`,
        awarded: sql<number>`coalesce(sum(${ships.awardedSeconds}) filter (where ${ships.state} = 'approved'), 0)::bigint`,
        first: sql<string | null>`min(${ships.createdAt})`,
        last: sql<string | null>`max(${ships.createdAt})`,
      })
      .from(ships)
      .where(where(ships.userId))
      .groupBy(ships.userId),
    db
      .select({
        userId: orders.userId,
        total: sql<number>`count(*)::int`,
        open: sql<number>`(count(*) filter (where ${orders.state} = 'placed'))::int`,
        fulfilled: sql<number>`(count(*) filter (where ${orders.state} = 'fulfilled'))::int`,
        cancelled: sql<number>`(count(*) filter (where ${orders.state} = 'rejected'))::int`,
      })
      .from(orders)
      .where(where(orders.userId))
      .groupBy(orders.userId),
  ]);

  const L = new Map(ledger.map((r) => [r.userId, r]));
  const S = new Map(shipStats.map((r) => [r.userId, r]));
  const O = new Map(orderStats.map((r) => [r.userId, r]));
  return rows.map((user) => ({ user, ledger: L.get(user.id), ships: S.get(user.id), orders: O.get(user.id) }));
}

function userFields({ user: u, ledger: l, ships: s, orders: o }: Awaited<ReturnType<typeof loadUsers>>[number]): Fields {
  const at = (v: string | null | undefined) => (v ? new Date(v).toISOString() : null);
  return {
    ID: u.id,
    Email: u.email,
    Name: u.displayName,
    "Slack ID": u.slackId,
    "Slack Profile": u.slackId ? `https://hackclub.slack.com/team/${u.slackId}` : null,
    Avatar: u.avatarUrl,
    Role: u.role,
    Eligibility: u.eligibility,
    "Verification Status": u.verificationStatus,
    "Eligibility Checked At": iso(u.eligibilityAt),
    Birthday: u.birthdate,
    Age: ageOn(u.birthdate),
    "HCA Subject": u.hcaSubject,
    "Hackatime ID": u.hackatimeAccountId,
    "Hackatime Linked At": iso(u.hackatimeLinkedAt),
    "Onboarded At": iso(u.onboardedAt),
    "Signed Up At": iso(u.createdAt),
    "Last Seen At": iso(u.lastSeenAt),
    "BITES Balance": l?.balance ?? 0,
    "BITES Earned": l?.earned ?? 0,
    "BITES Spent": l?.spent ?? 0,
    "BITES Refunded": l?.refunded ?? 0,
    "BITES Adjusted": l?.adjusted ?? 0,
    "Ships Total": s?.total ?? 0,
    "Ships Pending": s?.pending ?? 0,
    "Ships Approved": s?.approved ?? 0,
    "Ships Rejected": s?.rejected ?? 0,
    "Hours Claimed": hours(Number(s?.claimed ?? 0)),
    "Hours Approved": hours(Number(s?.awarded ?? 0)),
    "First Shipped At": at(s?.first),
    "Last Shipped At": at(s?.last),
    "Orders Total": o?.total ?? 0,
    "Orders Open": o?.open ?? 0,
    "Orders Fulfilled": o?.fulfilled ?? 0,
    "Orders Cancelled": o?.cancelled ?? 0,
    "Synced At": new Date().toISOString(),
  };
}

const reviewers = alias(users, "reviewer");
const handlers = alias(users, "handler");

async function loadShips(ids?: string[]) {
  if (ids && ids.length === 0) return [];
  const rows = await db
    .select({ ship: ships, author: users, reviewer: { name: reviewers.displayName, email: reviewers.email } })
    .from(ships)
    .innerJoin(users, eq(ships.userId, users.id))
    .leftJoin(reviewers, eq(ships.reviewerId, reviewers.id))
    .where(ids ? inArray(ships.id, ids) : undefined)
    .orderBy(ships.createdAt);
  const prevIds = [...new Set(rows.map((r) => r.ship.reshipOf).filter((v): v is string => Boolean(v)))];
  const prev = prevIds.length
    ? await db.select({ id: ships.id, number: ships.number }).from(ships).where(inArray(ships.id, prevIds))
    : [];
  const numbers = new Map(prev.map((p) => [p.id, p.number]));
  return rows.map((r) => ({ ...r, reshipNumber: r.ship.reshipOf ? (numbers.get(r.ship.reshipOf) ?? null) : null }));
}

type ShipRow = Awaited<ReturnType<typeof loadShips>>[number];

function shipFields({ ship: s, author: a, reviewer: r, reshipNumber }: ShipRow, userRec: string | undefined, origin: string): Fields {
  const scan = scanSummary(s.scan);
  return {
    Title: s.title,
    ID: s.id,
    Number: s.number,
    Author: userRec ? [userRec] : [],
    "Author Name": a.displayName,
    "Author Email": a.email,
    "Author Slack ID": a.slackId,
    State: s.state,
    Description: s.description,
    "Source URL": s.sourceUrl,
    "GitHub Username": githubUsername(s.sourceUrl),
    "Play URL": s.state === "approved" ? `${origin}/play/${s.id}` : null,
    "Ship URL": `${origin}/app/ships/${s.id}`,
    "Review URL": `${origin}/review?s=${s.id}`,
    "Data URI": s.dataUri,
    Bytes: s.bytes,
    "Hackatime Projects": s.hackatimeProjects.join("\n"),
    "Claimed Hours": hours(s.claimedSeconds),
    "Claimed Badges": s.claimedBadges,
    "Awarded Hours": hours(s.awardedSeconds),
    "Awarded Badges": s.awardedBadges ?? [],
    "Awarded BITES": s.awardedBites,
    Reviewer: r?.name ?? null,
    "Reviewer Email": r?.email ?? null,
    "Reviewed At": iso(s.reviewedAt),
    "Public Message": s.publicMessage,
    "Internal Note": s.internalNote,
    "Reship Of": reshipNumber ? `#${reshipNumber}` : null,
    "Scan Result": scan.result,
    Scan: scan.text,
    "Submitted At": iso(s.createdAt),
    "Synced At": new Date().toISOString(),
  };
}

async function loadOrders(ids?: string[]) {
  if (ids && ids.length === 0) return [];
  return db
    .select({ order: orders, user: users, handler: { name: handlers.displayName } })
    .from(orders)
    .innerJoin(users, eq(orders.userId, users.id))
    .leftJoin(handlers, eq(orders.handledBy, handlers.id))
    .where(ids ? inArray(orders.id, ids) : undefined)
    .orderBy(orders.createdAt);
}

function country(order: Order): string | null {
  try {
    return readAddress(order)?.country ?? null;
  } catch {
    return null;
  }
}

function orderFields(
  { order: o, user: u, handler: h }: Awaited<ReturnType<typeof loadOrders>>[number],
  userRec: string | undefined,
  origin: string,
): Fields {
  return {
    Order: `#${o.number} ${o.rewardName}`,
    ID: o.id,
    Number: o.number,
    User: userRec ? [userRec] : [],
    "User Name": u.displayName,
    "User Email": u.email,
    "User Slack ID": u.slackId,
    Reward: o.rewardName,
    "Reward Slug": o.rewardSlug,
    Digital: Boolean(REWARD_BY_SLUG.get(o.rewardSlug)?.digital),
    Cost: o.cost,
    State: o.state,
    Note: o.note,
    "Ship To Country": country(o),
    "Handled By": h?.name ?? null,
    "Handled At": iso(o.handledAt),
    "Internal Note": o.internalNote,
    "Placed At": iso(o.createdAt),
    "Admin URL": `${origin}/admin/orders`,
    "Synced At": new Date().toISOString(),
  };
}

// ---- YSWS submission -------------------------------------------------------------------------

async function primaryAddress(user: User): Promise<{ raw: HcaAddress | null; address: Address } | null> {
  if (staging()) return { raw: null, address: STAGING_ADDRESS };
  if (!user.hcaTokenEncrypted) return null;
  try {
    const list = await fetchAddresses(decrypt(user.hcaTokenEncrypted, tokenBinding(user.id)));
    if (list === "reconnect") return null;
    const sorted = [...list].sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)));
    for (const raw of sorted) {
      const address = normalizeAddress(raw, user.displayName);
      if (address) return { raw, address };
    }
  } catch (e) {
    console.error("[airtable] address lookup failed", e);
  }
  return null;
}

function names(user: User, raw: HcaAddress | null): { first: string; last: string } {
  const f = typeof raw?.first_name === "string" ? raw.first_name.trim() : "";
  const l = typeof raw?.last_name === "string" ? raw.last_name.trim() : "";
  if (f && l) return { first: f, last: l };
  const parts = user.displayName.trim().split(/\s+/);
  const last = parts.length > 1 ? parts.pop()! : "";
  return { first: parts.join(" "), last };
}

async function yswsFields({ ship: s, author: a, reviewer: r }: ShipRow, origin: string): Promise<Fields> {
  const found = await primaryAddress(a);
  const addr = found?.address;
  const { first, last } = names(a, found?.raw ?? null);
  const badges = (s.awardedBadges ?? []).map((b) => BADGE_BY_SLUG.get(b)).filter((b) => b != null);
  const deflated = s.awardedSeconds != null && s.awardedSeconds < s.claimedSeconds - 60;

  const fields: Fields = {
    "Shrink Ship ID": s.id,
    "Code URL": s.sourceUrl,
    "Playable URL": `${origin}/play/${s.id}`,
    "First Name": first,
    "Last Name": last,
    Email: a.email,
    Description: s.description,
    "GitHub Username": githubUsername(s.sourceUrl),
    "Address (Line 1)": addr?.line1,
    "Address (Line 2)": addr?.line2,
    City: addr?.city,
    "State / Province": addr?.region,
    Country: addr?.country,
    "ZIP / Postal Code": addr?.postcode,
    Birthday: a.birthdate,
    "Optional - Override Hours Spent": hours(s.awardedSeconds),
    "Justification - Hackatime Project Name(s) + Date Range(s)": `${s.hackatimeProjects.join(", ")}: all-time Hackatime total of ${hm(
      s.claimedSeconds,
    )} as of submission on ${day(s.createdAt)}.`,
    "Justification - Submitter Hackatime ID": a.hackatimeAccountId,
    "Justification - Specific Technical Features": [
      `A web app that fits in a ${s.bytes}-byte data: URI and loads nothing from the network.`,
      ...badges.map((b) => `${b.title}: ${b.desc}`),
    ].join("\n"),
    "Justification - Deflation Justification": deflated
      ? `Reviewer awarded ${hm(s.awardedSeconds!)} of the ${hm(s.claimedSeconds)} logged on Hackatime.`
      : undefined,
    "Justification - Additional Justification": [
      `Reviewed by ${r?.name ?? "a reviewer"} on ${s.reviewedAt ? day(s.reviewedAt) : "unknown date"}: ${origin}/review?s=${s.id}`,
      s.internalNote ? `Reviewer note: ${s.internalNote}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  };
  for (const k of Object.keys(fields)) if (fields[k] == null || fields[k] === "") delete fields[k];
  return fields;
}

// ---- entry points ----------------------------------------------------------------------------

export type SyncTargets = { users?: string[]; ships?: string[]; orders?: string[] };

// Pass `all: true` for a full resync; otherwise only the listed records (and their people) are pushed.
async function run(t: SyncTargets & { all?: boolean }, origin: string) {
  const shipRows = await loadShips(t.all ? undefined : (t.ships ?? []));
  const orderRows = await loadOrders(t.all ? undefined : (t.orders ?? []));
  const userIds = t.all
    ? undefined
    : [...new Set([...(t.users ?? []), ...shipRows.map((r) => r.author.id), ...orderRows.map((r) => r.user.id)])];
  const userRows = await loadUsers(userIds);

  const userRecs = await upsert(T.users(), userRows.map(userFields), "ID");
  await upsert(
    T.ships(),
    shipRows.map((r) => shipFields(r, userRecs.get(r.author.id), origin)),
    "ID",
  );
  await upsert(
    T.orders(),
    orderRows.map((r) => orderFields(r, userRecs.get(r.user.id), origin)),
    "ID",
  );

  const approved = shipRows.filter((r) => r.ship.state === "approved");
  let filed = 0;
  if (approved.length) {
    const have = await existingKeys(T.ysws(), "Shrink Ship ID");
    const todo = approved.filter((r) => !have.has(r.ship.id));
    const records: Fields[] = [];
    for (const r of todo) records.push(await yswsFields(r, origin));
    // Upsert rather than create, so a sync racing the approval can't file the same ship twice.
    await upsert(T.ysws(), records, "Shrink Ship ID");
    filed = records.length;
  }
  return { users: userRows.length, ships: shipRows.length, orders: orderRows.length, ysws: filed };
}

export async function syncAll(origin: string) {
  if (!airtableConfigured()) throw new Error("Airtable isn't configured.");
  return run({ all: true }, origin);
}

// An unshipped ship is deleted from Postgres, so drop its mirror row too.
export function queueRemoveShip(shipId: string): void {
  if (!airtableConfigured()) return;
  after(async () => {
    try {
      const q = new URLSearchParams({ filterByFormula: `{ID} = '${shipId.replace(/'/g, "")}'`, "fields[]": "ID" });
      const res = await call<{ records: Rec[] }>("GET", T.ships(), undefined, `?${q}`);
      if (res.records.length) {
        await call("DELETE", T.ships(), undefined, `?${res.records.map((r) => `records[]=${r.id}`).join("&")}`);
      }
    } catch (e) {
      console.error("[airtable] removing ship failed", e);
    }
  });
}

// Call from a server action or route handler; the push happens after the response.
export function queueSync(t: SyncTargets): void {
  if (!airtableConfigured()) return;
  after(async () => {
    try {
      await run(t, env.APP_URL || (await requestOrigin()));
    } catch (e) {
      console.error("[airtable] sync failed", e);
    }
  });
}

