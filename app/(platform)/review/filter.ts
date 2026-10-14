import type { Ship } from "@/lib/server/db/schema";

// Where a ship is in the secondary check. "unsent" means it never went out (or the check is off).
export const SECONDARY_FILTERS = ["all", "passed", "waiting", "failed", "unsent"] as const;
export type SecondaryFilter = (typeof SECONDARY_FILTERS)[number];

export const FILTER_LABEL: Record<SecondaryFilter, string> = {
  all: "All",
  passed: "Passed",
  waiting: "Waiting",
  failed: "Failed",
  unsent: "Not sent",
};

export const secondaryOf = (ship: Ship): Exclude<SecondaryFilter, "all"> => ship.secondaryState ?? "unsent";

export function parseFilter(f: string | undefined): SecondaryFilter {
  return SECONDARY_FILTERS.find((x) => x === f) ?? "all";
}

export function countBy<T extends { ship: Ship }>(items: T[]): Record<SecondaryFilter, number> {
  const counts = { all: items.length, passed: 0, waiting: 0, failed: 0, unsent: 0 };
  for (const q of items) counts[secondaryOf(q.ship)]++;
  return counts;
}

export function applyFilter<T extends { ship: Ship }>(items: T[], filter: SecondaryFilter): T[] {
  return filter === "all" ? items : items.filter((q) => secondaryOf(q.ship) === filter);
}
