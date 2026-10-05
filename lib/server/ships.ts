import "server-only";

import { and, desc, eq, isNotNull, isNull, ne, or } from "drizzle-orm";

import { blocking } from "@/lib/scan";
import { BADGE_BY_SLUG, MAX_URI_BYTES, MIN_SHIP_SECONDS, REPO_URL, bitesFor, byteLength } from "@/lib/program";

import { db, type Tx } from "./db/client";
import { ships, users, type Ship, type User, type Verdict } from "./db/schema";
import { env } from "./env";
import { fetchSeconds } from "./hackatime";
import { fullScan } from "./scan";
import * as ledger from "./ledger";
import { payReferral } from "./referrals";

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

export async function projectsInUse(userId: string, exceptShipId?: string): Promise<Set<string>> {
  const rows = await db
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

  let reshipOf: string | null = null;
  if (input.reshipOf) {
    const [prev] = await db.select().from(ships).where(and(eq(ships.id, input.reshipOf), eq(ships.userId, user.id))).limit(1);
    if (!prev || prev.state !== "rejected") throw new ShipError("You can only re-ship a ship that was sent back.");
    reshipOf = prev.id;
  }

  const used = await projectsInUse(user.id);
  const clash = projects.find((p) => used.has(p));
  if (clash) throw new ShipError(`"${clash}" is already part of another ship of yours.`);

  const scan = await fullScan(user, { dataUri, sourceUrl, hackatimeProjects: projects });
  const stop = blocking(scan)[0];
  if (stop) throw new ShipError(`${stop.label}: ${stop.detail ?? "didn't pass"}`);

  const seconds = await fetchSeconds(user.id, projects);
  if (seconds === null) throw new ShipError("Hackatime couldn't be read for your account. Is your activity set to visible?");
  if (seconds < MIN_SECONDS) throw new ShipError(`Hackatime only has ${Math.round(seconds / 60)} minutes on those projects. Log at least 30.`);

  const [ship] = await db
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
      reshipOf,
      scan,
    })
    .returning();
  return ship;
}

// The author pulls a ship back before anyone has decided it. It's deleted outright:
// nothing was awarded, and its Hackatime projects free up to ship again.
export async function unship(user: User, shipId: string): Promise<Ship> {
  return db.transaction(async (tx) => {
    const [ship] = await tx.select().from(ships).where(eq(ships.id, shipId)).for("update").limit(1);
    if (!ship || ship.userId !== user.id) throw new ShipError("That ship doesn't exist.");
    if (ship.state !== "pending") throw new ShipError("Only a ship that's still in review can be unshipped.");
    if (ship.verdict) throw new ShipError("A reviewer already got to this one, so it can't be unshipped.");
    const [gone] = await tx
      .delete(ships)
      .where(and(eq(ships.id, ship.id), eq(ships.state, "pending"), isNull(ships.verdict)))
      .returning();
    if (!gone) throw new ShipError("A reviewer already got to this one, so it can't be unshipped.");
    return gone;
  });
}

export type Decision =
  | { kind: "approve"; awardedHours: number; badges: string[]; message: string; internalNote: string }
  | { kind: "reject"; message: string; internalNote: string };

// What the author sees when the secondary check turns a ship down. They never hear there were two.
const SECONDARY_MESSAGE = "This one didn't pass review, so it can't be approved. If you think that's a mistake, ask in #shrink.";

const gateOpen = (ship: Ship) => !env.SECONDARY_CHECK_KEY || ship.secondaryState === "passed";

// A reject lands at once. An approve is held as the ship's verdict and only lands
// (BITES, DM, Airtable) once the secondary check has passed too; see settle().
// The guards in each WHERE stop a stale tab re-deciding; the ledger key stops a double award.
export async function decide(reviewer: User, shipId: string, decision: Decision): Promise<Ship> {
  const message = decision.message.trim();
  if (!message) throw new ShipError("Write a message to the author.");
  if (message.length > 2000) throw new ShipError("Keep the message under 2000 characters.");

  return db.transaction(async (tx) => {
    const [ship] = await tx.select().from(ships).where(eq(ships.id, shipId)).for("update").limit(1);
    if (!ship) throw new ShipError("That ship doesn't exist.");
    if (ship.state !== "pending" || ship.verdict) throw new ShipError("Someone already decided this one.");
    if (ship.userId === reviewer.id && reviewer.role !== "admin") throw new ShipError("You can't review your own ship.");

    if (decision.kind === "reject") {
      const [updated] = await tx
        .update(ships)
        .set({
          state: "rejected",
          reviewerId: reviewer.id,
          reviewedAt: new Date(),
          publicMessage: message,
          internalNote: decision.internalNote.trim() || null,
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
      reviewerId: reviewer.id,
      at: new Date().toISOString(),
      awardedSeconds: seconds,
      badges,
      bites: bitesFor(seconds, badges),
      message,
      internalNote: decision.internalNote.trim() || null,
    };

    const [held] = await tx
      .update(ships)
      .set({ verdict })
      .where(and(eq(ships.id, ship.id), eq(ships.state, "pending"), isNull(ships.verdict)))
      .returning();
    if (!held) throw new ShipError("Someone already decided this one.");
    return gateOpen(held) ? approve(tx, held, verdict) : held;
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
  await ledger.post(tx, {
    userId: ship.userId,
    amount: v.bites,
    type: "award",
    reason: ship.title,
    idempotencyKey: `ship:${ship.id}:award`,
    actorId: v.reviewerId,
  });
  await payReferral(tx, ship.userId, v.reviewerId);
  return updated;
}

// Call after the secondary check's result changes. Lands a held approval once it
// passed, or sends the ship back if it failed. Returns the ship only if this call
// decided it, so the caller knows to DM and sync.
export async function settle(shipId: string): Promise<Ship | null> {
  return db.transaction(async (tx) => {
    const [ship] = await tx.select().from(ships).where(eq(ships.id, shipId)).for("update").limit(1);
    if (!ship || ship.state !== "pending") return null;

    if (ship.secondaryState === "failed") {
      const note = `secondary check ${ship.secondaryScore ?? "?"}/10${ship.secondaryNote ? `: ${ship.secondaryNote}` : ""}`;
      const [updated] = await tx
        .update(ships)
        .set({
          state: "rejected",
          reviewerId: ship.verdict?.reviewerId ?? null,
          reviewedAt: new Date(),
          publicMessage: SECONDARY_MESSAGE,
          internalNote: [note, ship.verdict?.internalNote].filter(Boolean).join("\n"),
        })
        .where(and(eq(ships.id, ship.id), eq(ships.state, "pending")))
        .returning();
      return updated ?? null;
    }

    if (ship.verdict && gateOpen(ship)) return approve(tx, ship, ship.verdict);
    return null;
  });
}

export async function shipsOf(userId: string) {
  return db.select().from(ships).where(eq(ships.userId, userId)).orderBy(desc(ships.createdAt));
}

export async function shipById(id: string) {
  const [row] = await db.select().from(ships).where(eq(ships.id, id)).limit(1);
  return row ?? null;
}

export type QueueItem = {
  ship: Ship;
  author: Pick<User, "id" | "displayName" | "email" | "slackId" | "eligibility" | "avatarUrl">;
};

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
      author: users.displayName,
    })
    .from(ships)
    .innerJoin(users, eq(ships.userId, users.id))
    .where(eq(ships.state, "approved"))
    .orderBy(desc(ships.reviewedAt))
    .limit(limit);
}

// The queue is everything nobody has decided; done includes approvals still
// waiting on the secondary check.
export async function reviewQueue(tab: "queue" | "done" = "queue"): Promise<QueueItem[]> {
  const rows = await db
    .select({
      ship: ships,
      author: {
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        slackId: users.slackId,
        eligibility: users.eligibility,
        avatarUrl: users.avatarUrl,
      },
    })
    .from(ships)
    .innerJoin(users, eq(ships.userId, users.id))
    .where(
      tab === "queue"
        ? and(eq(ships.state, "pending"), isNull(ships.verdict))
        : or(ne(ships.state, "pending"), isNotNull(ships.verdict)),
    )
    .orderBy(ships.createdAt);
  return rows;
}
