import "server-only";

import { and, desc, eq, isNotNull, isNull, ne, not, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { blocking } from "@/lib/scan";
import { BADGE_BY_SLUG, MAX_URI_BYTES, MIN_SHIP_SECONDS, REPO_URL, bitesFor, byteLength, hm, shippingClosed } from "@/lib/program";

import { db, type Tx } from "./db/client";
import { ships, users, type Ship, type User, type Verdict } from "./db/schema";
import { env } from "./env";
import { fetchSeconds } from "./hackatime";
import { fullScan } from "./scan";
import * as ledger from "./ledger";
import { payReferral } from "./referrals";
import { withdraw } from "./secondary";
import { fillSlackHandles, publicName } from "./users";

export class ShipError extends Error {}

const MIN_SECONDS = MIN_SHIP_SECONDS;

export type ShipInput = {
  title: string;
  description: string;
  dataUri: string;
  sourceUrl: string;
  hackatimeProjects: string[];
  claimedBadges: string[];
  reshipOf?: string | null;
};

export function validateUri(uri: string): string {
  const trimmed = uri.trim();
  if (!trimmed) throw new ShipError("Paste your data URI.");
  if (!/^data:/i.test(trimmed)) throw new ShipError("That doesn't start with data: — the whole thing has to be a data URI.");
  if (/[\r\n]/.test(trimmed)) throw new ShipError("A data URI is one line. Yours has a line break in it.");
  if (!/^data:text\/html/i.test(trimmed)) throw new ShipError("It has to be a data:text/html URI so it runs as a page.");
  const bytes = byteLength(trimmed);
  if (bytes > MAX_URI_BYTES) throw new ShipError(`That's ${bytes} bytes. The limit is ${MAX_URI_BYTES}. Shrink it!`);
  return trimmed;
}

export async function projectsInUse(userId: string, exceptShipId?: string, tx?: Tx): Promise<Set<string>> {
  const rows = await (tx ?? db)
    .select({ p: ships.hackatimeProjects, id: ships.id })
    .from(ships)
    .where(and(eq(ships.userId, userId), ne(ships.state, "rejected")));
  const used = new Set<string>();
  for (const r of rows) if (r.id !== exceptShipId) for (const p of r.p) used.add(p);
  return used;
}

export async function createShip(user: User, input: ShipInput): Promise<Ship> {
  const title = input.title.trim();
  const description = input.description.trim();
  if (title.length < 1 || title.length > 80) throw new ShipError("Give it a title, up to 80 characters.");
  if (description.length < 20) throw new ShipError("Say a bit more about it — at least a sentence or two.");
  if (description.length > 2000) throw new ShipError("Keep the description under 2000 characters.");
  const dataUri = validateUri(input.dataUri);
  const sourceUrl = input.sourceUrl.trim();
  if (!sourceUrl) throw new ShipError("Add a link to the source repo.");
  if (!REPO_URL.test(sourceUrl)) throw new ShipError("The source link has to be a public git repo, like github.com/you/project.");

  const projects = [...new Set(input.hackatimeProjects.map((p) => p.trim()).filter(Boolean))];
  if (projects.length === 0) throw new ShipError("Pick the Hackatime project(s) you built this in.");
  const badges = [...new Set(input.claimedBadges)].filter((b) => BADGE_BY_SLUG.has(b));

  // Admins skip the checks below so they can try the whole flow, including after close.
  const admin = user.role === "admin";
  if (!input.reshipOf && shippingClosed() && !admin) {
    throw new ShipError("Shipping is closed. You can still resubmit a ship that was sent back.");
  }

  let reshipOf: Ship | null = null;
  if (input.reshipOf) {
    const [prev] = await db.select().from(ships).where(and(eq(ships.id, input.reshipOf), eq(ships.userId, user.id))).limit(1);
    if (!prev || prev.state !== "rejected") throw new ShipError("You can only re-ship a ship that was sent back.");
    if (prev.secondaryState === "failed") throw new ShipError("This one can't be resubmitted.");
    reshipOf = prev;
  }

  const used = await projectsInUse(user.id);
  const clash = projects.find((p) => used.has(p));
  if (clash) throw new ShipError(`"${clash}" is already part of another ship of yours.`);

  const scan = await fullScan(user, { dataUri, sourceUrl, hackatimeProjects: projects });
  const stop = admin ? null : blocking(scan)[0];
  if (stop) throw new ShipError(`${stop.label}: ${stop.detail ?? "didn't pass"}`);

  const seconds = (await fetchSeconds(user.id, projects)) ?? (admin ? 0 : null);
  if (seconds === null) throw new ShipError("Hackatime couldn't be read for your account. Is your activity set to visible?");
  if (seconds < MIN_SECONDS && !admin) throw new ShipError(`Hackatime only has ${Math.round(seconds / 60)} minutes on those projects. Log at least 30.`);

  // The checks above are slow, so two submits at once could both pass them. Re-check
  // under a per-user lock so the same Hackatime hours can't land in two ships.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ship:${user.id}`}))`);
    const used = await projectsInUse(user.id, undefined, tx);
    const clash = projects.find((p) => used.has(p));
    if (clash) throw new ShipError(`"${clash}" is already part of another ship of yours.`);
    if (reshipOf) {
      const [again] = await tx.select({ id: ships.id }).from(ships).where(eq(ships.reshipOf, reshipOf.id)).limit(1);
      if (again) throw new ShipError("You already resubmitted this one.");
    }
    const [ship] = await tx
      .insert(ships)
      .values({
        userId: user.id,
        title,
        description,
        dataUri,
        bytes: byteLength(dataUri),
        sourceUrl,
        hackatimeProjects: projects,
        claimedSeconds: seconds,
        claimedBadges: badges,
        reshipOf: reshipOf?.id ?? null,
        scan,
        // A resubmission's first submission was already checked, and admin ships are tests.
        ...((reshipOf || admin) && { secondaryState: "passed" as const, secondaryScore: reshipOf?.secondaryScore ?? null, secondaryNote: reshipOf?.secondaryNote ?? null }),
      })
      .returning();
    return ship;
  });
}

// The author pulls a ship back before anyone has decided it. It's deleted outright:
// nothing was awarded, and its Hackatime projects free up to ship again. Its
// secondary check submission is deleted too, which only works before anyone scored it.
export async function unship(user: User, shipId: string): Promise<Ship> {
  return db.transaction(async (tx) => {
    const [ship] = await tx.select().from(ships).where(eq(ships.id, shipId)).for("update").limit(1);
    if (!ship || ship.userId !== user.id) throw new ShipError("That ship doesn't exist.");
    if (ship.state !== "pending") throw new ShipError("Only a ship that's still in review can be unshipped.");
    // Unshipping deletes it, and a new ship can't be made once shipping closes.
    if (!ship.reshipOf && shippingClosed() && user.role !== "admin") throw new ShipError("Shipping is closed, so this one stays in review.");
    if (ship.verdict) throw new ShipError("A reviewer already got to this one, so it can't be unshipped.");
    // The row lock holds off settle() while the secondary check is asked to let go.
    if (ship.secondaryId) {
      const r = await withdraw(ship.secondaryId, `${user.displayName} (author, unshipped on SHRINK)`);
      if (r === "reviewed") throw new ShipError("A reviewer already got to this one, so it can't be unshipped.");
      if (r === "failed") throw new ShipError("Couldn't unship it just now. Try again in a minute.");
    }
    const [gone] = await tx
      .delete(ships)
      .where(and(eq(ships.id, ship.id), eq(ships.state, "pending"), isNull(ships.verdict)))
      .returning();
    if (!gone) throw new ShipError("A reviewer already got to this one, so it can't be unshipped.");
    return gone;
  });
}

export type Decision = (
  | { kind: "approve"; awardedHours: number; badges: string[]; message: string; internalNote: string }
  | { kind: "reject"; message: string; internalNote: string }
) & { replayId?: string };

// Prefilled for an admin confirming a failed secondary check. They can edit it before it goes out.
export const FRAUD_MESSAGE = "Unfortunately, your project did not pass fraud reviews. Please be on the lookout for a message from @Fraud Squad.";

// The fraud squad's score and note, kept with the rejection for the record.
const secondaryLine = (ship: Ship) => `secondary check ${ship.secondaryScore ?? "?"}/10${ship.secondaryNote ? `: ${ship.secondaryNote}` : ""}`;

const gateOpen = (ship: Ship) => !env.SECONDARY_CHECK_KEY || ship.secondaryState === "passed";

export const verdictKind = (v: Verdict) => v.kind ?? "approve";

// A reviewer's call that an admin hasn't checked yet.
export const awaitingCheck = (ship: Pick<Ship, "state" | "verdict">) => ship.state === "pending" && !!ship.verdict && !ship.verdict.confirmedBy;

const callLine = (v: Verdict) =>
  verdictKind(v) === "reject" ? "send back" : `approve ${hm(v.awardedSeconds)} for ${v.bites} BITES${v.badges.length ? ` with ${v.badges.join(", ")}` : ""}`;

// A reviewer's call, approve or send back, is held as the ship's verdict until an
// admin checks it on the second pass, confirming it or changing it. An admin's own
// call needs no second pass. Once confirmed, a send-back lands at once and an
// approval lands (BITES, DM, Airtable) once the secondary check has passed too; see settle().
// The guards in each WHERE stop a stale tab re-deciding; the ledger key stops a double award.
export async function decide(reviewer: User, shipId: string, decision: Decision): Promise<Ship> {
  const message = decision.message.trim();
  if (!message) throw new ShipError("Write a message to the author.");
  if (message.length > 2000) throw new ShipError("Keep the message under 2000 characters.");

  return db.transaction(async (tx) => {
    const [ship] = await tx.select().from(ships).where(eq(ships.id, shipId)).for("update").limit(1);
    if (!ship) throw new ShipError("That ship doesn't exist.");
    const admin = reviewer.role === "admin";
    // A failed secondary check holds the ship (even one with a call waiting) for an
    // admin to read the fraud squad's note and send it back. It can't be approved.
    const failed = ship.secondaryState === "failed";
    // An admin's second pass over a reviewer's held call.
    const check = admin && !failed && awaitingCheck(ship);
    if (ship.state !== "pending" || (ship.verdict && !failed && !check)) throw new ShipError("Someone already decided this one.");
    if (ship.userId === reviewer.id && !admin) throw new ShipError("You can't review your own ship.");
    if (failed && !admin) throw new ShipError("This one failed the fraud check. Only an admin can send it back.");
    if (failed && decision.kind === "approve") throw new ShipError("This one failed the fraud check, so it can't be approved.");
    if (!failed && !gateOpen(ship) && !admin) throw new ShipError("This one hasn't passed the secondary check yet. Only an admin can decide it now.");
    if (claimedByOther(ship, reviewer.id)) throw new ShipError("Someone else has this one open right now.");

    const now = new Date().toISOString();
    const prior = check ? ship.verdict! : null;
    // The second pass is only a check: the call stays the reviewer's, even if the admin changed it.
    const by = prior ? prior.reviewerId : reviewer.id;
    // Only for an admin's decision: a reviewer's waits on the second pass.
    const confirmed = admin ? { confirmedBy: reviewer.id, confirmedAt: now } : {};
    // The reviewer's recording is the one their call was made in.
    const replayId = prior && ship.replayId ? ship.replayId : (decision.replayId ?? null);
    const changedFrom = (v: Verdict) => (prior && callLine(prior) !== callLine(v) ? `Second pass changed the reviewer's call: ${callLine(prior)}.` : null);
    // A reviewer's call goes no further than this until an admin checks it.
    const hold = async (verdict: Verdict) => {
      const [held] = await tx
        .update(ships)
        .set({ verdict, claimedBy: null, claimedAt: null, replayId })
        .where(and(eq(ships.id, ship.id), eq(ships.state, "pending"), check ? sql`${ships.verdict}->>'confirmedBy' is null` : isNull(ships.verdict)))
        .returning();
      if (!held) throw new ShipError("Someone already decided this one.");
      return held;
    };

    if (decision.kind === "reject") {
      const verdict: Verdict = {
        kind: "reject",
        reviewerId: by,
        at: prior ? prior.at : now,
        awardedSeconds: 0,
        badges: [],
        bites: 0,
        message,
        internalNote: decision.internalNote.trim() || null,
        ...confirmed,
      };
      if (!admin) return hold(verdict);
      const note = [failed && secondaryLine(ship), changedFrom(verdict), ship.verdict?.internalNote, decision.internalNote.trim()].filter(Boolean).join("\n");
      const [updated] = await tx
        .update(ships)
        .set({
          state: "rejected",
          reviewerId: by,
          reviewedAt: new Date(),
          publicMessage: message,
          internalNote: note || null,
          // Keeps who checked it. A failed check's held approval stays as it was.
          ...(check && { verdict: { ...verdict, internalNote: note || null } }),
          claimedBy: null,
          claimedAt: null,
          replayId,
        })
        .where(and(eq(ships.id, ship.id), eq(ships.state, "pending")))
        .returning();
      if (!updated) throw new ShipError("Someone already decided this one.");
      return updated;
    }

    const hours = Number(decision.awardedHours);
    if (!Number.isFinite(hours) || hours <= 0) throw new ShipError("Award more than zero hours, or reject.");
    const awardedSeconds = Math.round(hours * 3600);
    if (awardedSeconds > ship.claimedSeconds + 180) {
      throw new ShipError(`Hackatime only shows ${(ship.claimedSeconds / 3600).toFixed(1)}h. You can't award more than that.`);
    }
    const badges = [...new Set(decision.badges)].filter((b) => BADGE_BY_SLUG.has(b));
    const seconds = Math.min(awardedSeconds, ship.claimedSeconds);
    const verdict: Verdict = {
      kind: "approve",
      reviewerId: by,
      at: prior ? prior.at : now,
      awardedSeconds: seconds,
      badges,
      bites: bitesFor(seconds, badges),
      message,
      internalNote: decision.internalNote.trim() || null,
      ...confirmed,
    };
    verdict.internalNote = [changedFrom(verdict), prior?.internalNote, verdict.internalNote].filter(Boolean).join("\n") || null;

    const held = await hold(verdict);
    return verdict.confirmedBy && gateOpen(held) ? approve(tx, held, verdict) : held;
  });
}

async function approve(tx: Tx, ship: Ship, v: Verdict): Promise<Ship> {
  const [updated] = await tx
    .update(ships)
    .set({
      state: "approved",
      reviewerId: v.reviewerId,
      reviewedAt: new Date(),
      awardedSeconds: v.awardedSeconds,
      awardedBadges: v.badges,
      awardedBites: v.bites,
      publicMessage: v.message,
      internalNote: v.internalNote,
    })
    .where(and(eq(ships.id, ship.id), eq(ships.state, "pending")))
    .returning();
  if (!updated) throw new ShipError("Someone already decided this one.");

  await ledger.lockUser(ship.userId, tx);
  // Under 0.9h awards nothing: no ledger entry (it takes no zeros) and no referral payout.
  if (v.bites > 0) {
    await ledger.post(tx, {
      userId: ship.userId,
      amount: v.bites,
      type: "award",
      reason: ship.title,
      idempotencyKey: `ship:${ship.id}:award`,
      actorId: v.reviewerId,
    });
    await payReferral(tx, ship.userId, v.reviewerId);
  }
  return updated;
}

// Call after the secondary check's result changes. Lands a held approval once it
// passed, if an admin has confirmed it. A failure decides nothing here: the ship waits in the queue for an admin
// to confirm it (see decide()). Returns the ship only if this call decided it, so
// the caller knows to DM and sync.
export async function settle(shipId: string): Promise<Ship | null> {
  return db.transaction(async (tx) => {
    const [ship] = await tx.select().from(ships).where(eq(ships.id, shipId)).for("update").limit(1);
    if (!ship || ship.state !== "pending") return null;
    const v = ship.verdict;
    if (v?.confirmedBy && verdictKind(v) === "approve" && gateOpen(ship)) return approve(tx, ship, v);
    return null;
  });
}

export async function shipsOf(userId: string) {
  return db.select().from(ships).where(eq(ships.userId, userId)).orderBy(desc(ships.createdAt));
}

// A sent-back ship can be resubmitted once, unless it failed the fraud check.
export const canResubmit = (ship: Ship, resubmitted: boolean) => ship.state === "rejected" && ship.secondaryState !== "failed" && !resubmitted;

export async function wasResubmitted(id: string): Promise<boolean> {
  const [row] = await db.select({ id: ships.id }).from(ships).where(eq(ships.reshipOf, id)).limit(1);
  return Boolean(row);
}

export async function shipById(id: string) {
  const [row] = await db.select().from(ships).where(eq(ships.id, id)).limit(1);
  return row ?? null;
}

export type QueueItem = {
  ship: Ship;
  // Reviewers see people only by Slack handle: no name or email, so none is loaded.
  author: Pick<User, "id" | "slackId" | "slackHandle" | "eligibility" | "avatarUrl">;
  // Whoever has it open right now, if their claim is still live.
  claimer: Pick<User, "id" | "slackId" | "slackHandle"> | null;
};

// A reviewer's desk renews its claim every minute while the ship is open, so a
// closed tab frees the ship within this long.
export const CLAIM_TTL_SECONDS = 150;

const claimLive = sql`${ships.claimedAt} > now() - make_interval(secs => ${CLAIM_TTL_SECONDS})`;

function claimedByOther(ship: Ship, reviewerId: string): boolean {
  return !!ship.claimedBy && ship.claimedBy !== reviewerId && !!ship.claimedAt && Date.now() - ship.claimedAt.getTime() < CLAIM_TTL_SECONDS * 1000;
}

// Takes (or renews) the reviewer's hold on a pending ship and drops any other they
// had, so each reviewer holds at most one. Returns who has it if someone else does.
export async function claim(reviewer: User, shipId: string): Promise<{ ok: true } | { ok: false; by: string }> {
  return db.transaction(async (tx) => {
    await tx
      .update(ships)
      .set({ claimedBy: null, claimedAt: null })
      .where(and(eq(ships.claimedBy, reviewer.id), ne(ships.id, shipId)));
    const [took] = await tx
      .update(ships)
      .set({ claimedBy: reviewer.id, claimedAt: new Date() })
      .where(
        and(
          eq(ships.id, shipId),
          eq(ships.state, "pending"),
          or(isNull(ships.claimedBy), eq(ships.claimedBy, reviewer.id), not(claimLive)),
        ),
      )
      .returning({ id: ships.id });
    if (took) return { ok: true };
    const [row] = await tx
      .select({ slackHandle: users.slackHandle })
      .from(ships)
      .innerJoin(users, eq(ships.claimedBy, users.id))
      .where(eq(ships.id, shipId))
      .limit(1);
    return { ok: false, by: row ? publicName(row) : "Someone" };
  });
}

export async function release(reviewer: User, shipId: string): Promise<void> {
  await db
    .update(ships)
    .set({ claimedBy: null, claimedAt: null })
    .where(and(eq(ships.id, shipId), eq(ships.claimedBy, reviewer.id)));
}

const claimers = alias(users, "claimer");

export async function showcase(limit = 9) {
  return db
    .select({
      id: ships.id,
      title: ships.title,
      dataUri: ships.dataUri,
      bytes: ships.bytes,
      awardedBites: ships.awardedBites,
      awardedBadges: ships.awardedBadges,
      reviewedAt: ships.reviewedAt,
      author: users.slackHandle,
    })
    .from(ships)
    .innerJoin(users, eq(ships.userId, users.id))
    .where(eq(ships.state, "approved"))
    .orderBy(desc(ships.reviewedAt))
    .limit(limit);
}

export type QueueTab = "queue" | "done" | "check";

// The queue is everything nobody has decided, with failed secondary checks first
// (held calls included) since they're waiting on an admin, then resubmissions. Done includes
// calls still held for the second pass or the secondary check. Check is the admins'
// second pass: reviewers' calls nobody has confirmed yet.
export async function reviewQueue(tab: QueueTab = "queue"): Promise<QueueItem[]> {
  const failed = and(eq(ships.state, "pending"), eq(ships.secondaryState, "failed"));
  const unchecked = and(
    eq(ships.state, "pending"),
    isNotNull(ships.verdict),
    sql`${ships.verdict}->>'confirmedBy' is null`,
    or(isNull(ships.secondaryState), ne(ships.secondaryState, "failed")),
  );
  const rows = await db
    .select({
      ship: ships,
      author: {
        id: users.id,
        slackId: users.slackId,
        slackHandle: users.slackHandle,
        eligibility: users.eligibility,
        avatarUrl: users.avatarUrl,
      },
      claimer: { id: claimers.id, slackId: claimers.slackId, slackHandle: claimers.slackHandle },
    })
    .from(ships)
    .innerJoin(users, eq(ships.userId, users.id))
    .leftJoin(claimers, and(eq(ships.claimedBy, claimers.id), claimLive))
    .where(
      tab === "queue"
        ? or(and(eq(ships.state, "pending"), isNull(ships.verdict)), failed)
        : tab === "check"
          ? unchecked
          : and(or(ne(ships.state, "pending"), isNotNull(ships.verdict)), not(failed!)),
    )
    .orderBy(desc(sql`coalesce(${ships.secondaryState} = 'failed', false)`), desc(isNotNull(ships.reshipOf)), ships.createdAt);
  await fillSlackHandles(rows.flatMap((r) => (r.claimer ? [r.author, r.claimer] : [r.author])));
  return rows;
}
