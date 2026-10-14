import { requireRole } from "@/lib/server/auth/current";
import { env } from "@/lib/server/env";
import { fetchProjects } from "@/lib/server/hackatime";
import { claim, reviewQueue, type QueueItem } from "@/lib/server/ships";

import Desk from "./Desk";
import { applyFilter, countBy, parseFilter } from "./filter";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; tab?: string; decided?: string; f?: string }>;
}) {
  const reviewer = await requireRole("reviewer", "/review");
  const { s, tab, decided, f } = await searchParams;
  const showDone = tab === "done";
  const all = await reviewQueue(showDone ? "done" : "queue");
  if (showDone) all.reverse();

  const isAdmin = reviewer.role === "admin";
  // Reviewers only get ships the secondary check has passed; admins can filter by it.
  const passedOnly = !isAdmin && !!env.SECONDARY_CHECK_KEY && !showDone;
  const filter = passedOnly ? "passed" : parseFilter(f);
  const queue = applyFilter(all, filter);
  const heldByOther = (q: QueueItem) => !!q.claimer && q.claimer.id !== reviewer.id;
  const decidable = (q: QueueItem) =>
    q.ship.state === "pending" &&
    (q.ship.secondaryState === "failed" ? isAdmin : !q.ship.verdict) &&
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
  const holder = (q: QueueItem) => (q.ship.id === current?.ship.id ? lockedBy : heldByOther(q) ? q.claimer!.displayName : null);

  const idx = current ? queue.findIndex((q) => q.ship.id === current.ship.id) : -1;
  const next = idx >= 0 ? (queue.slice(idx + 1).find((q) => !heldByOther(q)) ?? null) : null;
  const elsewhere = queue.find((q) => q.ship.id !== current?.ship.id && !heldByOther(q)) ?? null;

  const live = current && !showDone ? await fetchProjects(current.author.id).catch(() => null) : null;
  const liveSeconds = live
    ? live.filter((p) => current!.ship.hackatimeProjects.includes(p.name)).reduce((a, p) => a + p.seconds, 0)
    : null;

  return (
    <Desk
      reviewer={reviewer}
      queue={queue}
      filter={filter}
      counts={passedOnly ? null : countBy(all)}
      current={current}
      showDone={showDone}
      decided={decided}
      lockedBy={lockedBy}
      holder={holder}
      next={next}
      elsewhere={elsewhere}
      live={live}
      liveSeconds={liveSeconds}
    />
  );
}
