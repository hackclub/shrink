import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { H1, when } from "@/app/components/ui/bits";
import { hm } from "@/lib/program";
import { FAST_REVIEW_MS, duration } from "@/lib/review-time";
import { parseRange, rangeStart, reviewerDaily, reviewerDecisions, reviewerSummaries, reviewerUndecided, type AuditDecision } from "@/lib/server/audit";
import { requireRole } from "@/lib/server/auth/current";
import { db } from "@/lib/server/db/client";
import { users } from "@/lib/server/db/schema";
import { listReplays } from "@/lib/server/replay";
import { cn } from "@/lib/utils";

import { AdminNav, DailyBars, RangeTabs, SessionsTable, Stat } from "../../ui";

export default async function ReviewerAuditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ range?: string }> }) {
  const { id } = await params;
  await requireRole("admin", `/admin/audit/reviewer/${id}`);
  const range = parseRange((await searchParams).range);
  const [person] = await db.select({ id: users.id, displayName: users.displayName, role: users.role }).from(users).where(eq(users.id, id)).limit(1);
  if (!person) notFound();

  const from = rangeStart(range);
  const [summaries, decisions, undecided, daily, sessions] = await Promise.all([
    reviewerSummaries(range),
    reviewerDecisions(id, range),
    reviewerUndecided(id, range),
    reviewerDaily(id, range),
    listReplays({ userId: id, from, limit: 100 }),
  ]);
  const s = summaries.find((x) => x.id === id);
  const reviewMs = decisions.reduce((t, d) => t + d.ms, 0);
  const slowest = decisions.reduce((m, d) => Math.max(m, d.ms), 0);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <H1 sub={<Link href={`/admin/audit?range=${range}`} className="underline-offset-2 hover:underline">← all reviewers</Link>}>{person.displayName}</H1>
        <AdminNav />
      </div>

      <div className="mb-4">
        <RangeTabs range={range} base={`/admin/audit/reviewer/${id}`} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Decisions" value={decisions.length} sub={s ? `${s.approved} approved · ${s.sentBack} sent back` : undefined} />
        <Stat label="Review time" value={duration(reviewMs)} sub="active, on ships they decided" />
        <Stat label="Avg per review" value={decisions.length ? duration(reviewMs / decisions.length) : "–"} sub={slowest ? `longest ${duration(slowest)}` : undefined} />
        <Stat label="Median per review" value={s?.decisions ? duration(s.medianMs) : "–"} warn={!!s?.decisions && s.medianMs < FAST_REVIEW_MS} />
        <Stat label="Desk time" value={duration(s?.activeMs ?? 0)} sub="all active time on the desk" />
        <Stat
          label="Flags"
          value={(s?.fast ?? 0) + (s?.unrecorded ?? 0) + (s?.brokenSessions ?? 0)}
          warn={!!((s?.fast ?? 0) + (s?.unrecorded ?? 0) + (s?.brokenSessions ?? 0))}
          sub={`${s?.fast ?? 0} fast · ${s?.unrecorded ?? 0} unrecorded · ${s?.brokenSessions ?? 0} broken`}
        />
      </div>

      <div className="mb-8">
        <DailyBars days={daily} />
      </div>

      <h2 className="mb-3 text-lg font-semibold tracking-tight">Decisions</h2>
      {decisions.length === 0 ? <p className="mb-8 font-medium text-black/50">No decisions in this range.</p> : <Decisions rows={decisions} />}

      {undecided.length > 0 && (
        <>
          <h2 className="mb-1 text-lg font-semibold tracking-tight">Opened but not decided by them</h2>
          <p className="mb-3 text-sm text-black/60">Ships they spent time on that they skipped, or that someone else decided.</p>
          <div className="card mb-8 overflow-x-auto bg-white">
            <table className="w-full text-sm">
              <tbody>
                {undecided.map((u) => (
                  <tr key={u.shipId} className="border-b last:border-b-0">
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs text-black/50">#{u.number}</span> {u.title}
                    </td>
                    <td className="px-3 py-2 text-xs text-black/60">{u.state}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{duration(u.ms)}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap text-black/60">{when(u.lastAt)}</td>
                    <td className="px-3 py-2 text-right">
                      <Link href={`/admin/audit/replay/${u.sessionId}?ship=${u.shipId}`} className="text-xs font-medium underline underline-offset-2">
                        watch
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 className="mb-3 text-lg font-semibold tracking-tight">Recordings</h2>
      <SessionsTable rows={sessions} showReviewer={false} />
    </>
  );
}

function Decisions({ rows }: { rows: AuditDecision[] }) {
  const max = Math.max(...rows.map((r) => r.ms), 1);
  return (
    <div className="card mb-8 overflow-x-auto bg-white">
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs text-black/60">
          <tr>
            <th className="px-3 py-2 font-medium">Ship</th>
            <th className="px-3 py-2 font-medium">Decision</th>
            <th className="px-3 py-2 text-right font-medium">Hours</th>
            <th className="px-3 py-2 font-medium">Active time</th>
            <th className="px-3 py-2 font-medium">Decided</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const fast = r.ms < FAST_REVIEW_MS;
            return (
              <tr key={r.shipId} className="border-b align-top last:border-b-0 hover:bg-black/[0.02]">
                <td className="px-3 py-2">
                  <Link href={`/review?s=${r.shipId}&tab=done`} className="font-medium underline-offset-2 hover:underline">
                    <span className="font-mono text-xs text-black/50">#{r.number}</span> {r.title}
                  </Link>
                  <span className="block text-xs text-black/50">by {r.author}</span>
                  {(r.message || r.internalNote) && (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-black/60">what they wrote</summary>
                      {r.message && <p className="mt-1 max-w-[60ch] whitespace-pre-wrap">{r.message}</p>}
                      {r.internalNote && <p className="mt-1 max-w-[60ch] font-mono whitespace-pre-wrap text-black/60">internal: {r.internalNote}</p>}
                    </details>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className={cn("pill", r.kind === "sent back" ? "pill-rejected" : r.kind === "approved" ? "pill-approved" : "pill-pending")}>{r.kind}</span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs whitespace-nowrap tabular-nums">
                  {r.awardedSeconds != null ? `${hm(r.awardedSeconds)} / ` : ""}
                  {hm(r.claimedSeconds)}
                  {r.bites != null && <span className="block text-black/50">{r.bites} BITES</span>}
                </td>
                <td className="min-w-40 px-3 py-2">
                  <span className={cn("font-mono tabular-nums", fast && "font-semibold text-destructive")} title={fast ? `Under ${FAST_REVIEW_MS / 1000}s of active time` : undefined}>
                    {fast && "⚠ "}
                    {duration(r.ms)}
                  </span>
                  <span className="mt-1 block h-1 w-full rounded-full bg-black/5">
                    <span className={cn("block h-1 rounded-full", fast ? "bg-destructive" : "bg-black/60")} style={{ width: `${(r.ms / max) * 100}%` }} />
                  </span>
                  {r.sessions > 1 && <span className="text-[11px] text-black/50">over {r.sessions} visits</span>}
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap text-black/60">{when(r.decidedAt)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {r.replayId ? (
                    <Link href={`/admin/audit/replay/${r.replayId}?ship=${r.shipId}`} className="text-xs font-medium underline underline-offset-2">
                      watch decision
                    </Link>
                  ) : (
                    <span className="text-xs text-destructive">no recording</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
