"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { queueRemoveShip, queueSync } from "@/lib/server/airtable";
import { actionUser } from "@/lib/server/auth/current";
import { loadShipAndAuthor, shipShipped, shipUnshipped } from "@/lib/server/effects";
import { requestOrigin } from "@/lib/server/origin";
import { submit } from "@/lib/server/secondary";
import type { Check } from "@/lib/scan";
import { hm } from "@/lib/program";
import { deepScan, forgetSource, quickScan, repoKey, type ScanInput } from "@/lib/server/scan";
import { take, takeDistinct } from "@/lib/server/ratelimit";
import { ShipError, createShip, unship } from "@/lib/server/ships";

export type ShipFormState = { error: string | null };

export async function shipAction(_prev: ShipFormState, form: FormData): Promise<ShipFormState> {
  const user = await actionUser();
  const limit = await take(user.id, "ship", SCANS_PER_WINDOW, SCAN_WINDOW_MS);
  if (!limit.ok) return { error: `Too many attempts. Try again in ${limit.retryInMinutes} min.` };
  const str = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
  const repos = await repoLimit(user.id, str("source_url"));
  if (repos) return { error: repos };
  let id: string;
  try {
    const ship = await createShip(user, {
      title: str("title"),
      description: str("description"),
      dataUri: str("data_uri"),
      sourceUrl: str("source_url"),
      hackatimeProjects: form.getAll("hackatime").map(String),
      claimedBadges: form.getAll("badge").map(String),
      reshipOf: str("reship_of") || null,
    });
    id = ship.id;
  } catch (e) {
    if (e instanceof ShipError) return { error: e.message };
    console.error("[ship] failed", e);
    return { error: "Something broke on our side. Try again in a minute." };
  }

  const origin = await requestOrigin();
  after(async () => {
    const row = await loadShipAndAuthor(id);
    if (row) await shipShipped(row.ship, row.author, origin);
    await submit(id, origin).catch((e) => console.error("[secondary] submit threw", e));
  });
  queueSync({ ships: [id] });
  revalidatePath("/", "layout");
  redirect(`/app/ships/${id}?shipped=1`);
}

export async function unshipAction(shipId: string): Promise<ShipFormState> {
  const user = await actionUser();
  try {
    const ship = await unship(user, String(shipId));
    after(() => shipUnshipped(ship, user));
    queueRemoveShip(ship.id);
  } catch (e) {
    if (e instanceof ShipError) return { error: e.message };
    console.error("[unship] failed", e);
    return { error: "Something broke on our side. Try again in a minute." };
  }
  revalidatePath("/", "layout");
  return { error: null };
}

export type ScanResult = { checks: Check[] } | { limited: string };

const SCANS_PER_WINDOW = 30;
const SCAN_WINDOW_MS = 30 * 60_000;
// Scanning a repo costs host API calls and an LLM run; a real participant works
// on a handful at most, so cap distinct repos rather than scans.
const REPOS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60_000;

async function repoLimit(userId: string, sourceUrl: string): Promise<string | null> {
  const key = repoKey(sourceUrl);
  if (!key) return null;
  const limit = await takeDistinct(userId, "scan:repo", key, REPOS_PER_DAY, DAY_MS);
  return limit.ok
    ? null
    : `You've checked ${REPOS_PER_DAY} different repos today. Use one you've already checked, or try a new one in ${hm(limit.retryInMinutes * 60)}.`;
}

async function scanLimit(userId: string, kind: "quick" | "deep", sourceUrl: string): Promise<string | null> {
  const limit = await take(userId, `scan:${kind}`, SCANS_PER_WINDOW, SCAN_WINDOW_MS);
  if (!limit.ok) return `That's a lot of scans. Try again in ${hm(limit.retryInMinutes * 60)}.`;
  return repoLimit(userId, sourceUrl);
}

export async function quickScanAction(input: ScanInput, fresh = false): Promise<ScanResult> {
  const user = await actionUser();
  const i = clean(input);
  const limited = await scanLimit(user.id, "quick", i.sourceUrl);
  if (limited) return { limited };
  if (fresh) forgetSource(i.sourceUrl);
  return { checks: await quickScan(user, i) };
}

export async function deepScanAction(input: ScanInput, fresh = false): Promise<ScanResult> {
  const user = await actionUser();
  const i = clean(input);
  const limited = await scanLimit(user.id, "deep", i.sourceUrl);
  if (limited) return { limited };
  if (fresh) forgetSource(i.sourceUrl);
  return { checks: await deepScan(i) };
}

function clean(input: ScanInput): ScanInput {
  return {
    dataUri: String(input.dataUri ?? "").trim().slice(0, 8192),
    sourceUrl: String(input.sourceUrl ?? "").trim().slice(0, 512),
    hackatimeProjects: (Array.isArray(input.hackatimeProjects) ? input.hackatimeProjects : []).map(String).slice(0, 50),
  };
}
