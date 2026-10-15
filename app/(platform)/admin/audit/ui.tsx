import Link from "next/link";

import { when } from "@/app/components/ui/bits";
import { duration } from "@/lib/review-time";
import { RANGES, type Range } from "@/lib/server/audit";
import type { ReplayRow } from "@/lib/server/replay";
import { cn } from "@/lib/utils";

import { live, span, trouble } from "./health";

export function AdminNav() {
  return (
    <nav className="mb-[clamp(1.25rem,2vw,32px)] flex gap-1 text-[0.95rem] font-medium">
      <Link href="/admin" className="rounded-[4px] px-2 py-1 text-black/60 hover:bg-black/5">
        people
      </Link>
      <Link href="/admin/orders" className="rounded-[4px] px-2 py-1 text-black/60 hover:bg-black/5">
        orders
      </Link>
      <Link href="/admin/audit" className="rounded-[4px] bg-accent px-2 py-1">
        audit
      </Link>
    </nav>
  );
}

export function RangeTabs({ range, base }: { range: Range; base: string }) {
  return (
    <div className="flex gap-1 text-[0.95rem] font-medium" role="tablist" aria-label="Time range">
      {(Object.keys(RANGES) as Range[]).map((r) => (
        <Link
          key={r}
          href={`${base}?range=${r}`}
          role="tab"
          aria-selected={r === range}
          className={cn("rounded-[4px] px-2 py-1", r === range ? "bg-black text-white" : "text-black/60 hover:bg-black/5")}
        >
          {r === "all" ? "all time" : `last ${r}`}
        </Link>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, warn }: { label: string; value: React.ReactNode; sub?: React.ReactNode; warn?: boolean }) {
  return (
    <div className="card flex flex-col gap-0.5 bg-white px-4 py-3">
      <span className="text-xs font-medium text-black/60">{label}</span>
      <span className={cn("font-mono text-2xl font-semibold tabular-nums tracking-tight", warn && "text-destructive")}>{value}</span>
      {sub && <span className="text-xs text-black/60">{sub}</span>}
    </div>
  );
}

// Active minutes per day: one series, so one ink, no legend. Hover a bar for its numbers.
export function DailyBars({ days }: { days: { day: string; ms: number; reviewMs: number }[] }) {
  const max = Math.max(...days.map((d) => d.ms), 1);
  const label = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <figure className="card bg-white px-4 py-3">
      <figcaption className="mb-2 flex items-baseline justify-between text-xs font-medium text-black/60">
        <span>Active time per day (UTC)</span>
        <span className="font-mono">peak {duration(max)}</span>
      </figcaption>
      <div className="flex h-24 items-end gap-[2px] border-b border-black/15">
        {days.map((d) => (
          <div key={d.day} className="group relative flex h-full flex-1 items-end" title={`${label(d.day)}: ${duration(d.ms)} active, ${duration(d.reviewMs)} on ships`}>
            <div className="w-full rounded-t-[4px] bg-black/75 transition-colors group-hover:bg-black" style={{ height: d.ms ? `max(2px, ${(d.ms / max) * 100}%)` : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px] text-black/50">
        <span>{label(days[0].day)}</span>
        <span>{label(days[days.length - 1].day)}</span>
      </div>
    </figure>
  );
}

export function Health({ r }: { r: ReplayRow }) {
  const t = trouble(r);
  if (t.length) return <span className="text-destructive">⚠ {[...t, r.error].filter(Boolean).join(" · ")}</span>;
  // A note from the client (retries that got through, a dropped oversize event): worth a look, nothing lost.
  if (r.error) return <span className="text-amber-700" title={r.error}>{r.error}</span>;
  return <span className="text-black/50">{live(r) ? "● recording now" : "ok"}</span>;
}

export function SessionsTable({ rows, showReviewer = true }: { rows: ReplayRow[]; showReviewer?: boolean }) {
  if (!rows.length) return <p className="font-medium text-black/50">No recordings in this range.</p>;
  return (
    <div className="card overflow-x-auto bg-white">
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs text-black/60">
          <tr>
            {showReviewer && <th className="px-3 py-2 font-medium">Reviewer</th>}
            <th className="px-3 py-2 font-medium">Started</th>
            <th className="px-3 py-2 font-medium">Length</th>
            <th className="px-3 py-2 font-medium">Size</th>
            <th className="px-3 py-2 font-medium">Health</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-b-0 hover:bg-black/[0.02]">
              {showReviewer && (
                <td className="px-3 py-2">
                  <Link href={`/admin/audit/reviewer/${r.reviewer.id}`} className="font-medium underline-offset-2 hover:underline">
                    {r.reviewer.displayName}
                  </Link>
                </td>
              )}
              <td className="px-3 py-2 whitespace-nowrap">{when(r.startedAt)}</td>
              <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{span(r)}</td>
              <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{(r.bytes / 1e6).toFixed(1)} MB</td>
              <td className="max-w-[40ch] truncate px-3 py-2 text-xs">
                <Health r={r} />
              </td>
              <td className="px-3 py-2 text-right">
                <Link href={`/admin/audit/replay/${r.id}`} className="text-xs font-medium underline underline-offset-2">
                  watch
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
