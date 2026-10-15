import { requireRole } from "@/lib/server/auth/current";
import { env } from "@/lib/server/env";
import { fetchProjects } from "@/lib/server/hackatime";
import { repoView } from "@/lib/server/scan";
import { awaitingCheck, claim, reviewQueue, type QueueItem, type QueueTab } from "@/lib/server/ships";
import { publicName } from "@/lib/server/users";

import Desk from "./Desk";
import { applyFilter, countBy, parseFilter } from "./filter";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; tab?: string; decided?: string; f?: string }>;
}) {
  const reviewer = await requireRole("reviewer", "/review");
  const { s, tab, decided, f } = await searchParams;
  const isAdmin = reviewer.role === "admin";
  // The second pass is admins' only.
  const view: QueueTab = tab === "done" ? "done" : tab === "check" && isAdmin ? "check" : "queue";
  const showDone = view === "done";
  const all = await reviewQueue(view);
  if (showDone) all.reverse();

  // Reviewers only get ships the secondary check has passed; admins can filter by it.
  const passedOnly = !isAdmin && !!env.SECONDARY_CHECK_KEY && !showDone;
  const filter = passedOnly ? "passed" : parseFilter(f);
  const queue = applyFilter(all, filter);
  const heldByOther = (q: QueueItem) => !!q.claimer && q.claimer.id !== reviewer.id;
  const decidable = (q: QueueItem) =>
    q.ship.state === "pending" &&
    (q.ship.secondaryState === "failed" || awaitingCheck(q.ship) ? isAdmin : !q.ship.verdict) &&
    (q.author.id !== reviewer.id || isAdmin);

  const firstFree = queue.find((q) => !heldByOther(q)) ?? null;
  let current = queue.find((q) => q.ship.id === s) ?? (showDone ? null : (firstFree ?? queue[0])) ?? null;
  // Right after a decision, skip ahead rather than land on a ship someone else just opened.
  if (decided && current && heldByOther(current) && firstFree) current = firstFree;

  // Opening a ship claims it, so two reviewers never work the same one.
  let lockedBy: string | null = null;
  if (current && !showDone && decidable(current)) {
    const r = await claim(reviewer, current.ship.id);
    if (!r.ok) lockedBy = r.by;
  }
  const holder = (q: QueueItem) => (q.ship.id === current?.ship.id ? lockedBy : heldByOther(q) ? publicName(q.claimer!) : null);

  const idx = current ? queue.findIndex((q) => q.ship.id === current.ship.id) : -1;
  const next = idx >= 0 ? (queue.slice(idx + 1).find((q) => !heldByOther(q)) ?? null) : null;
  const elsewhere = queue.find((q) => q.ship.id !== current?.ship.id && !heldByOther(q)) ?? null;

  // Hackatime and GitHub are the slow parts; the desk renders without them and they stream in.
  const live = current && !showDone ? fetchProjects(current.author.id).catch(() => null) : Promise.resolve(null);
  const repo = current?.ship.sourceUrl ? repoView(current.ship.sourceUrl).catch(() => null) : Promise.resolve(null);

  return (
    <Desk
      reviewer={reviewer}
      queue={queue}
      filter={filter}
      counts={passedOnly ? null : countBy(all)}
      current={current}
      tab={view}
      decided={decided}
      lockedBy={lockedBy}
      holder={holder}
      next={next}
      elsewhere={elsewhere}
      live={live}
      repo={repo}
    />
  );
}
