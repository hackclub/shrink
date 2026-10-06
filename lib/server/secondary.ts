import "server-only";

import { and, eq, inArray, isNull, ne } from "drizzle-orm";

import { db } from "./db/client";
import { ships, type Ship } from "./db/schema";
import { loadShipAndAuthor, shipDecided } from "./effects";
import { env } from "./env";
import { playUrl } from "./play";
import { settle } from "./ships";

// Every ship also goes through a secondary check, run outside SHRINK. It happens
// alongside the normal review: an approval is held until the check passes (see
// settle() in ships.ts), and a failed check sends the ship back. Authors only
// ever see one review. Results are polled by /api/cron/secondary.

type Remote = {
  id: string;
  externalId: string | null;
  state: "awaiting_review" | "awaiting_outcome" | "rejected_fraud" | "decided";
  creditedSeconds: number | null;
  demoUrl: string | null;
  review: { trustScore: number; note: string | null; at: string } | null;
};

export const secondaryEnabled = () => Boolean(env.SECONDARY_CHECK_KEY);

async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(`${env.SECONDARY_CHECK_URL}/api/v1/ysws${path}`, {
    method,
    headers: { authorization: `Bearer ${env.SECONDARY_CHECK_KEY}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, json };
}

const why = (json: unknown) => (json as { message?: string }).message ?? "no message";

type Author = NonNullable<Awaited<ReturnType<typeof loadShipAndAuthor>>>["author"];

// Idempotent on externalId: a repeat returns the existing project, only filling in a missing demoUrl.
async function post(ship: Ship, author: Author, origin: string) {
  const hackatimeId = /^\d+$/.test(author.hackatimeAccountId ?? "") ? Number(author.hackatimeAccountId) : undefined;
  if (!author.slackId && !hackatimeId) {
    console.error(`[secondary] ship ${ship.id}: author has no Slack or Hackatime id`);
    return null;
  }
  const { status, json } = await call<Remote & { message?: string }>("POST", "/projects", {
    name: ship.title,
    kind: "hackatime",
    codeUrl: ship.sourceUrl,
    demoUrl: playUrl(origin, ship.id),
    submitter: { slackId: author.slackId ?? undefined, hackatimeId },
    hackatimeProjects: ship.hackatimeProjects,
    externalId: ship.id,
  });
  if (status !== 200 && status !== 201) {
    console.error(`[secondary] submit ${ship.id} failed: ${status} ${why(json)}`);
    return null;
  }
  return json;
}

// Idempotent on the ship id, so a retry after a timeout can't double-submit.
export async function submit(shipId: string, origin: string): Promise<boolean> {
  if (!secondaryEnabled()) return false;
  const row = await loadShipAndAuthor(shipId);
  if (!row || row.ship.secondaryId) return false;
  const { ship, author } = row;
  const json = await post(ship, author, origin);
  if (!json) return false;
  const [saved] = await db
    .update(ships)
    .set({ secondaryId: json.id, secondaryState: "waiting" })
    .where(and(eq(ships.id, ship.id), isNull(ships.secondaryId)))
    .returning({ id: ships.id });
  // Unshipped while this was in flight: take it back out on their side too.
  if (!saved && !(await db.select({ id: ships.id }).from(ships).where(eq(ships.id, ship.id)).limit(1)).length) {
    await withdraw(json.id, `${author.displayName} (author, unshipped on SHRINK)`);
    return false;
  }
  return true;
}

// Deletes a submission nobody has scored yet, for an unshipped ship. "reviewed" means
// a fraud reviewer already scored it, after which their side refuses.
export async function withdraw(secondaryId: string, signedOffBy: string): Promise<"ok" | "reviewed" | "failed"> {
  if (!secondaryEnabled()) return "ok";
  const { status, json } = await call("DELETE", `/projects/${secondaryId}`, { signedOffBy });
  if (status === 200 || status === 404) return "ok";
  if (status === 409 && /already reviewed/i.test(why(json))) return "reviewed";
  console.error(`[secondary] withdraw ${secondaryId} failed: ${status} ${why(json)}`);
  return "failed";
}

// Stores a result and settles the ship. Returns the ship if that decided it.
async function apply(p: Remote): Promise<Ship | null> {
  if (!p.externalId) return null;
  const state = p.state === "rejected_fraud" ? "failed" : p.state === "awaiting_review" ? "waiting" : "passed";
  await db
    .update(ships)
    .set({
      secondaryId: p.id,
      secondaryState: state,
      secondaryScore: p.review?.trustScore ?? null,
      secondaryNote: p.review?.note ?? null,
      secondarySeconds: p.creditedSeconds,
      secondaryAt: p.review ? new Date(p.review.at) : null,
    })
    .where(eq(ships.id, p.externalId));
  return settle(p.externalId);
}

// Tells the check what we decided, which closes it on their side. Only possible
// once it passed; a 409 means it's already closed.
export async function report(ship: Ship): Promise<void> {
  if (!secondaryEnabled() || !ship.secondaryId || ship.secondaryState !== "passed" || ship.state === "pending") return;
  const { status, json } = await call("POST", `/projects/${ship.secondaryId}/outcome`, {
    status: ship.state,
    reason: ship.state === "rejected" ? ship.internalNote || ship.publicMessage || "Sent back in review." : undefined,
  });
  if (status !== 200 && status !== 409) console.error(`[secondary] outcome for ${ship.id} failed: ${status} ${why(json)}`);
}

// Checks one ship right now, e.g. just after a reviewer approved it.
export async function refresh(shipId: string, origin: string): Promise<Ship | null> {
  if (!secondaryEnabled()) return null;
  const [ship] = await db.select().from(ships).where(eq(ships.id, shipId)).limit(1);
  if (!ship?.secondaryId) return null;
  const { status, json } = await call<{ project: Remote }>("GET", `/projects/${ship.secondaryId}`);
  if (status !== 200) return null;
  const settled = await apply(json.project);
  const now = settled ?? (await db.select().from(ships).where(eq(ships.id, shipId)).limit(1))[0];
  if (settled) await announce(settled, origin);
  if (now) await report(now);
  return settled;
}

async function announce(ship: Ship, origin: string) {
  const row = await loadShipAndAuthor(ship.id);
  if (row) await shipDecided(row.ship, row.author, origin);
}

async function list(state: Remote["state"]): Promise<Remote[]> {
  const out: Remote[] = [];
  for (let offset = 0; ; offset += 100) {
    const { status, json } = await call<{ total: number; projects: Remote[]; message?: string }>(
      "GET",
      `/projects?state=${state}&limit=100&offset=${offset}`,
    );
    if (status !== 200) throw new Error(`list ${state} failed: ${status} ${why(json)}`);
    out.push(...json.projects);
    if (!json.projects.length || out.length >= json.total) return out;
  }
}

// The cron's whole job: send anything unsent, then pull every result that moved.
export async function sync(origin: string) {
  if (!secondaryEnabled()) return { skipped: "SECONDARY_CHECK_KEY isn't set" };

  // Includes ships approved before the check existed; new ones are sent when shipped.
  const unsent = await db
    .select({ id: ships.id })
    .from(ships)
    .where(and(ne(ships.state, "rejected"), isNull(ships.secondaryId)));
  let sent = 0;
  for (const s of unsent) if (await submit(s.id, origin)) sent++;

  // Projects sent before we had a play link: resending fills it in. Stops once they all have one.
  let linked = 0;
  for (const p of await list("awaiting_review")) {
    if (p.demoUrl || !p.externalId) continue;
    const row = await loadShipAndAuthor(p.externalId);
    if (row && (await post(row.ship, row.author, origin))) linked++;
  }

  const results = [...(await list("awaiting_outcome")), ...(await list("rejected_fraud"))];
  const ids = [...new Set(results.map((p) => p.externalId).filter((id): id is string => !!id))];
  const local = new Map(
    (ids.length ? await db.select().from(ships).where(inArray(ships.id, ids)) : []).map((s) => [s.id, s]),
  );

  const decided: string[] = [];
  let reported = 0;
  for (const p of results) {
    const ship = p.externalId ? local.get(p.externalId) : undefined;
    if (!ship) continue;
    // Failed and already sent back: nothing left to do, and that list only grows.
    if (p.state === "rejected_fraud" && ship.secondaryState === "failed" && ship.state !== "pending") continue;
    const settled = await apply(p);
    if (settled) {
      decided.push(settled.id);
      await announce(settled, origin);
    }
    // Still open on their side but decided here (e.g. sent back before the check finished).
    if (p.state === "awaiting_outcome") {
      const [now] = await db.select().from(ships).where(eq(ships.id, ship.id)).limit(1);
      if (now && now.state !== "pending") {
        await report(now);
        reported++;
      }
    }
  }
  return { sent, linked, checked: results.length, decided, reported };
}
