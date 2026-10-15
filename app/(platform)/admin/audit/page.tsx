import Link from "next/link";

import { Avatar, AvatarFallback, AvatarImage } from "@/app/components/ui/avatar";
import { H1, when } from "@/app/components/ui/bits";
import { FAST_REVIEW_MS, IDLE_MS, duration } from "@/lib/review-time";
import { parseRange, rangeStart, reviewerSummaries } from "@/lib/server/audit";
import { requireRole } from "@/lib/server/auth/current";
import { listReplays } from "@/lib/server/replay";
import { cn } from "@/lib/utils";

import { trouble } from "./health";
import { AdminNav, RangeTabs, SessionsTable, Stat } from "./ui";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requireRole("admin", "/admin/audit");
  const range = parseRange((await searchParams).range);
  const from = rangeStart(range);
  const [people, sessions] = await Promise.all([reviewerSummaries(range), listReplays({ limit: 50, from })]);

  const total = people.reduce(
    (t, p) => ({ decisions: t.decisions + p.decisions, reviewMs: t.reviewMs + p.reviewMs, activeMs: t.activeMs + p.activeMs, fast: t.fast + p.fast, unrecorded: t.unrecorded + p.unrecorded }),
    { decisions: 0, reviewMs: 0, activeMs: 0, fast: 0, unrecorded: 0 },
  );
  const broken = sessions.filter((s) => trouble(s).length).length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <H1 sub={`Who reviewed what, how long they actually spent on it, and the recording of every desk visit. Active time skips any gap over ${IDLE_MS / 1000}s without a mouse move, click, scroll or key, including time away in another tab.`}>
          review audit
        </H1>
        <AdminNav />
      </div>

      <div className="mb-4">
        <RangeTabs range={range} base="/admin/audit" />
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Decisions" value={total.decisions} />
        <Stat label="Active review time" value={duration(total.reviewMs)} sub={total.decisions ? `${duration(total.reviewMs / total.decisions)} per decision` : undefined} />
        <Stat label="Active desk time" value={duration(total.activeMs)} sub="in range, on ships they decided" />
        <Stat label={`Under ${FAST_REVIEW_MS / 1000}s`} value={total.fast} warn={total.fast > 0} sub="decisions made very fast" />
        <Stat label="Recording problems" value={broken + total.unrecorded} warn={broken + total.unrecorded > 0} sub={`${broken} broken sessions · ${total.unrecorded} unrecorded decisions`} />
      </div>

      <h2 className="mb-3 text-lg font-semibold tracking-tight">Reviewers</h2>
      {people.length === 0 ? (
        <p className="mb-8 font-medium text-black/50">No reviews in this range.</p>
      ) : (
        <div className="card mb-8 overflow-x-auto bg-white">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-black/60">
              <tr>
                <th className="px-3 py-2 font-medium">Reviewer</th>
                <th className="px-3 py-2 text-right font-medium">Decisions</th>
                <th className="px-3 py-2 text-right font-medium" title="Active time on the ships they decided">
                  Review time
                </th>
                <th className="px-3 py-2 text-right font-medium">Avg</th>
                <th className="px-3 py-2 text-right font-medium">Median</th>
                <th className="px-3 py-2 text-right font-medium" title="Active time in range on ships they decided, not browsing">
                  Desk time
                </th>
                <th className="px-3 py-2 font-medium">Flags</th>
                <th className="px-3 py-2 font-medium">Last active</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const flags = [
                  p.fast && `${p.fast} under ${FAST_REVIEW_MS / 1000}s`,
                  p.unrecorded && `${p.unrecorded} unrecorded`,
                  p.brokenSessions && `${p.brokenSessions} broken recording${p.brokenSessions === 1 ? "" : "s"}`,
                ].filter(Boolean);
                return (
                  <tr key={p.id} className="border-b last:border-b-0 hover:bg-black/[0.02]">
                    <td className="px-3 py-2">
                      <Link href={`/admin/audit/reviewer/${p.id}?range=${range}`} className="flex items-center gap-2 font-medium underline-offset-2 hover:underline">
                        <Avatar className="size-6">
                          {p.avatarUrl && <AvatarImage src={p.avatarUrl} alt="" />}
                          <AvatarFallback className="text-[10px]">{p.displayName.slice(0, 2)}</AvatarFallback>
                        </Avatar>
                        {p.displayName}
                        {p.role === "admin" && <span className="font-mono text-[10px] text-black/40">admin</span>}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {p.decisions}
                      {p.decisions > 0 && (
                        <span className="ml-1 text-xs text-black/50">
                          ({p.approved}✓ {p.sentBack}↩)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{duration(p.reviewMs)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{p.decisions ? duration(p.reviewMs / p.decisions) : "–"}</td>
                    <td className={cn("px-3 py-2 text-right font-mono tabular-nums", p.decisions && p.medianMs < FAST_REVIEW_MS && "text-destructive")}>
                      {p.decisions ? duration(p.medianMs) : "–"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{duration(p.activeMs)}</td>
                    <td className="px-3 py-2 text-xs">{flags.length ? <span className="text-destructive">⚠ {flags.join(" · ")}</span> : <span className="text-black/40">none</span>}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap text-black/60">{p.lastActive ? when(p.lastActive) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-3 text-lg font-semibold tracking-tight">Recent recordings</h2>
      <SessionsTable rows={sessions} />
    </>
  );
}
