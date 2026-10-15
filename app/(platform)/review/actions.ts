"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { queueSync } from "@/lib/server/airtable";
import { actionRole } from "@/lib/server/auth/current";
import { loadShipAndAuthor, shipDecided } from "@/lib/server/effects";
import { requestOrigin } from "@/lib/server/origin";
import { replayLive } from "@/lib/server/replay";
import { refresh, report } from "@/lib/server/secondary";
import { repoFile } from "@/lib/server/scan";
import { ShipError, awaitingCheck, claim, decide, release, shipById } from "@/lib/server/ships";

export type DecisionState = { error: string | null };

export async function decideAction(_prev: DecisionState, form: FormData): Promise<DecisionState> {
  const reviewer = await actionRole("reviewer");
  const str = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
  const shipId = str("ship_id");
  const kind = str("kind");
  const nextId = str("next_id");
  const f = /^(passed|waiting|failed|unsent)$/.test(str("f")) ? `&f=${str("f")}` : "";
  const tab = str("tab") === "check" ? "&tab=check" : "";
  const replayId = str("replay_id");
  if (!(await replayLive(reviewer.id, replayId).catch(() => false))) {
    return { error: "Nothing was decided: this desk's recording hasn't reached the server. Reload the page and try again." };
  }

  // held: an approval waiting on the secondary check. check: a reviewer's call waiting on an admin.
  let held = false;
  let check = false;
  try {
    if (kind === "approve") {
      const ship = await decide(reviewer, shipId, {
        kind: "approve",
        awardedHours: Number(str("hours")),
        badges: form.getAll("badge").map(String),
        message: str("message"),
        internalNote: str("internal_note"),
        replayId,
      });
      check = awaitingCheck(ship);
      held = !check && ship.state === "pending";
    } else if (kind === "reject") {
      const ship = await decide(reviewer, shipId, { kind: "reject", message: str("message"), internalNote: str("internal_note"), replayId });
      check = awaitingCheck(ship);
    } else {
      return { error: "Pick approve or send back." };
    }
  } catch (e) {
    if (e instanceof ShipError) return { error: e.message };
    console.error("[review] failed", e);
    return { error: "Something broke on our side. Nothing was decided. Try again." };
  }

  // To the reviewer it went through: the second pass is admins' business.
  const done = held ? "held" : "1";
  const to = (id: string) => (id ? `/review?s=${id}&decided=${done}${f}${tab}` : `/review?decided=${done}${f}${tab}`);
  revalidatePath("/", "layout");
  // Nothing goes out until an admin confirms it.
  if (check) redirect(to(nextId));

  const origin = await requestOrigin();
  after(async () => {
    try {
      // A held approval may be able to land already, if the secondary check finished first.
      if (held) {
        if (await refresh(shipId, origin)) queueSync({ ships: [shipId] });
        return;
      }
      const row = await loadShipAndAuthor(shipId);
      if (!row) return;
      await shipDecided(row.ship, row.author, origin);
      await report(row.ship);
    } catch (e) {
      console.error("[review] after-decision effects failed", e);
    }
  });
  if (!held) queueSync({ ships: [shipId] });
  redirect(to(nextId));
}

// The desk calls this on open and every minute after, to keep its hold on the ship.
export async function claimAction(shipId: string): Promise<{ ok: true } | { ok: false; by: string }> {
  const reviewer = await actionRole("reviewer");
  return claim(reviewer, shipId);
}

// The repo browser on the desk opens files through this, scoped to the ship's own repo.
export async function repoFileAction(shipId: string, ref: string, path: string): Promise<{ text: string } | { error: string }> {
  await actionRole("reviewer");
  const ship = await shipById(shipId);
  if (!ship?.sourceUrl) return { error: "This ship has no source link." };
  return repoFile(ship.sourceUrl, ref, path);
}

export async function releaseAction(shipId: string): Promise<void> {
  const reviewer = await actionRole("reviewer");
  await release(reviewer, shipId);
}
