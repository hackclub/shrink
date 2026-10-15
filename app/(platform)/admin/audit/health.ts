import type { ReplayRow } from "@/lib/server/replay";

export const live = (r: ReplayRow) => !r.endedAt && !r.cutOff;

export function trouble(r: ReplayRow): string[] {
  const t: string[] = [];
  if (r.chunks === 0) t.push("nothing uploaded");
  if (r.gaps > 0) t.push(`${r.gaps} chunk${r.gaps === 1 ? "" : "s"} missing`);
  if (r.cutOff) t.push("cut off");
  return t;
}

export function span(r: ReplayRow): string {
  const ms = (r.endedAt ?? r.lastChunkAt).getTime() - r.startedAt.getTime();
  const m = Math.max(0, Math.round(ms / 60_000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
