import Link from "next/link";

import { AppFrame, ByteMeter, Empty, H1, Hours, Notice, StatePill, when } from "@/app/components/ui/bits";
import { BADGE_BY_SLUG, capFor } from "@/lib/program";
import type { Check } from "@/lib/scan";
import type { Ship } from "@/lib/server/db/schema";
import { requireRole } from "@/lib/server/auth/current";
import { fetchProjects } from "@/lib/server/hackatime";
import { FRAUD_MESSAGE, reviewQueue } from "@/lib/server/ships";

import DecisionForm from "./DecisionForm";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; tab?: string; decided?: string }>;
}) {
  const reviewer = await requireRole("reviewer", "/review");
  const { s, tab, decided } = await searchParams;
  const showDone = tab === "done";
  const queue = await reviewQueue(showDone ? "done" : "queue");
  if (showDone) queue.reverse();

  const current = queue.find((q) => q.ship.id === s) ?? (showDone ? null : queue[0]) ?? null;
  const idx = current ? queue.findIndex((q) => q.ship.id === current.ship.id) : -1;
  const next = idx >= 0 ? queue[idx + 1] ?? null : null;

  const live =
    current && !showDone
      ? await fetchProjects(current.author.id).catch(() => null)
      : null;
  const liveSeconds = live
    ? live.filter((p) => current!.ship.hackatimeProjects.includes(p.name)).reduce((a, p) => a + p.seconds, 0)
    : null;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <H1 sub={showDone ? "Everything already decided, newest first." : `${queue.length} waiting, oldest first. Decide, and the next one opens.`}>
          review desk
        </H1>
        <nav className="mb-[clamp(1.25rem,2vw,32px)] flex gap-1 text-[0.95rem] font-medium">
          <Link href="/review" className={`rounded-[4px] px-2 py-1 ${!showDone ? "bg-accent" : "text-black/60 hover:bg-black/5"}`}>
            queue
          </Link>
          <Link href="/review?tab=done" className={`rounded-[4px] px-2 py-1 ${showDone ? "bg-accent" : "text-black/60 hover:bg-black/5"}`}>
            decided
          </Link>
        </nav>
      </div>

      {decided && (
        <div className="mb-5">
          <Notice kind="ok">
            {decided === "held" ? "Approved. It lands (BITES and DM) once the secondary check passes." : "Decided. The author gets a DM."}
          </Notice>
        </div>
      )}

      {queue.length === 0 ? (
        <Empty>{showDone ? "Nothing decided yet." : "Queue's empty. Go touch grass."}</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-[clamp(1rem,2vw,32px)] lg:grid-cols-[280px_minmax(0,1fr)]">
          <ol className="flex max-h-[70svh] flex-col gap-1 overflow-y-auto lg:sticky lg:top-4">
            {queue.map((q) => (
              <li key={q.ship.id}>
                <Link
                  href={`/review?s=${q.ship.id}${showDone ? "&tab=done" : ""}`}
                  aria-current={current?.ship.id === q.ship.id}
                  className="queue-row"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-semibold tracking-tight">{q.ship.title}</span>
                    <span className="muted font-mono text-xs">#{q.ship.number}</span>
                  </span>
                  <span className="muted mt-0.5 flex items-center justify-between gap-2 text-sm font-medium">
                    <span className="truncate">{q.author.displayName}</span>
                    <span>{showDone || q.ship.secondaryState === "failed" ? <ShipPill ship={q.ship} /> : <Hours seconds={q.ship.claimedSeconds} />}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>

          {current && (
            <div className="grid grid-cols-1 gap-[clamp(1rem,2vw,32px)] xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[1.6rem] font-semibold leading-tight tracking-tight">{current.ship.title}</h2>
                    <p className="font-mono text-xs text-black/50">
                      #{current.ship.number} · {current.ship.bytes} bytes · shipped {when(current.ship.createdAt)}
                      {current.ship.reshipOf && " · re-ship"}
                    </p>
                  </div>
                  <ShipPill ship={current.ship} />
                </div>
                <div className="card overflow-hidden">
                  <div className="aspect-[4/3] bg-ink">
                    <AppFrame key={current.ship.id} uri={current.ship.dataUri} title={current.ship.title} />
                  </div>
                </div>
                <ByteMeter bytes={current.ship.bytes} />
                <details className="card bg-white">
                  <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-black/60">the URI · click to expand</summary>
                  <pre className="max-h-64 overflow-auto border-t-2 border-panel-border p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap select-all">
                    {current.ship.dataUri}
                  </pre>
                </details>
                <div>
                  <p className="label">the author says</p>
                  <p className="whitespace-pre-wrap font-medium leading-relaxed text-black/85">{current.ship.description}</p>
                </div>
              </div>

              <div className="flex flex-col gap-5">
                <div className="border-t-4 border-rule pt-3">
                  <p className="label">author</p>
                  <p className="text-[1.1rem] font-semibold tracking-tight">{current.author.displayName}</p>
                  <p className="text-sm font-medium text-black/60">
                    {current.author.email}
                    {current.author.slackId && (
                      <>
                        {" "}
                        ·{" "}
                        <a href={`https://hackclub.slack.com/team/${current.author.slackId}`} target="_blank" rel="noreferrer" className="underline">
                          slack
                        </a>
                      </>
                    )}
                    {" · "}
                    <span className={current.author.eligibility === "eligible" ? "" : "text-[#c1121f]"}>{current.author.eligibility.replace(/_/g, " ")}</span>
                  </p>
                </div>

                <div className="border-t-4 border-rule pt-3">
                  <p className="label">hackatime</p>
                  <ul className="font-mono text-sm">
                    {current.ship.hackatimeProjects.map((p) => (
                      <li key={p} className="flex justify-between gap-3">
                        <span className="truncate">{p}</span>
                        <span className="text-black/60">{live ? <Hours seconds={live.find((x) => x.name === p)?.seconds ?? 0} /> : "—"}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 border-t-2 border-panel-border pt-2 text-sm font-medium text-black/60">
                    claimed at ship: <Hours seconds={current.ship.claimedSeconds} />
                    {liveSeconds !== null && liveSeconds !== current.ship.claimedSeconds && (
                      <>
                        {" "}
                        · now: <Hours seconds={liveSeconds} />
                      </>
                    )}
                    {current.author.slackId && (
                      <>
                        {" "}
                        ·{" "}
                        <a href={`https://hackatime.hackclub.com/admin/timeline?user_ids=${current.author.slackId}`} target="_blank" rel="noreferrer" className="underline">
                          timeline
                        </a>
                      </>
                    )}
                  </p>
                </div>

                {current.ship.sourceUrl && (
                  <p className="text-sm font-medium">
                    source:{" "}
                    <a href={current.ship.sourceUrl} target="_blank" rel="noreferrer" className="font-mono underline underline-offset-4 break-all">
                      {current.ship.sourceUrl}
                    </a>
                  </p>
                )}

                {current.ship.scan && <ScanSummary checks={current.ship.scan} />}

                <SecondarySummary ship={current.ship} />

                {current.ship.state === "pending" && current.ship.secondaryState === "failed" ? (
                  reviewer.role === "admin" ? (
                    <DecisionForm
                      key={current.ship.id}
                      shipId={current.ship.id}
                      nextId={next?.ship.id ?? ""}
                      claimedSeconds={current.ship.claimedSeconds}
                      claimedBadges={current.ship.claimedBadges}
                      isOwn={false}
                      fraudMessage={FRAUD_MESSAGE}
                    />
                  ) : (
                    <Notice>The fraud check failed this one. An admin reads their note and sends it back.</Notice>
                  )
                ) : current.ship.verdict && current.ship.state === "pending" ? (
                  <div className="card border-black bg-white px-4 py-3">
                    <p className="label">approved · {when(new Date(current.ship.verdict.at))} · waiting on the secondary check</p>
                    <p className="font-pixel text-[1.4rem]">
                      +{current.ship.verdict.bites} BITES{" "}
                      <span className="font-mono text-xs opacity-60">
                        <Hours seconds={current.ship.verdict.awardedSeconds} /> · cap {capFor(current.ship.verdict.badges)} ·{" "}
                        {current.ship.verdict.badges.map((b) => BADGE_BY_SLUG.get(b)?.title).join(", ") || "no badges"}
                      </span>
                    </p>
                    <p className="mt-2 whitespace-pre-wrap font-medium">{current.ship.verdict.message}</p>
                    {current.ship.verdict.internalNote && (
                      <p className="mt-2 border-t border-current/20 pt-2 font-mono text-xs opacity-70">internal: {current.ship.verdict.internalNote}</p>
                    )}
                    <p className="mt-2 border-t border-current/20 pt-2 text-sm font-medium text-black/60">
                      The author still sees it as in review. It lands once the check passes. If it fails, it comes back to the queue for an admin.
                    </p>
                  </div>
                ) : current.ship.state === "pending" ? (
                  <DecisionForm
                    key={current.ship.id}
                    shipId={current.ship.id}
                    nextId={next?.ship.id ?? ""}
                    claimedSeconds={current.ship.claimedSeconds}
                    claimedBadges={current.ship.claimedBadges}
                    isOwn={current.author.id === reviewer.id}
                  />
                ) : (
                  <div className={`card px-4 py-3 ${current.ship.state === "approved" ? "border-black bg-white" : "bg-ink text-white"}`}>
                    <p className="label" style={current.ship.state === "rejected" ? { color: "rgba(255,255,255,0.6)" } : undefined}>
                      {current.ship.state} · {current.ship.reviewedAt ? when(current.ship.reviewedAt) : ""}
                    </p>
                    {current.ship.state === "approved" && (
                      <p className="font-pixel text-[1.4rem]">
                        +{current.ship.awardedBites} BITES{" "}
                        <span className="font-mono text-xs opacity-60">
                          <Hours seconds={current.ship.awardedSeconds ?? 0} /> · cap {capFor(current.ship.awardedBadges ?? [])} ·{" "}
                          {(current.ship.awardedBadges ?? []).map((b) => BADGE_BY_SLUG.get(b)?.title).join(", ") || "no badges"}
                        </span>
                      </p>
                    )}
                    <p className="mt-2 whitespace-pre-wrap font-medium">{current.ship.publicMessage}</p>
                    {current.ship.internalNote && (
                      <p className="mt-2 border-t border-current/20 pt-2 font-mono text-xs opacity-70">internal: {current.ship.internalNote}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// "approved" here would be a lie until the held approval lands.
function ShipPill({ ship }: { ship: Ship }) {
  if (ship.state === "pending" && ship.secondaryState === "failed") return <span className="pill pill-rejected">fraud</span>;
  if (ship.state === "pending" && ship.verdict) return <span className="pill pill-pending">held</span>;
  return <StatePill state={ship.state} />;
}

// Internal only: authors never see that a second check exists.
function SecondarySummary({ ship }: { ship: Ship }) {
  if (!ship.secondaryState) return null;
  const label = { waiting: "waiting", passed: "passed", failed: "failed" }[ship.secondaryState];
  return (
    <div className={`rounded-[10px] border-2 px-4 py-3 ${ship.secondaryState === "failed" ? "border-[#c1121f] bg-white" : "border-panel-border bg-white"}`}>
      <p className="label mb-1">secondary check</p>
      <p className="text-sm font-semibold">
        {label}
        {ship.secondaryScore != null && <span className="font-mono"> · {ship.secondaryScore}/10</span>}
        {ship.secondarySeconds != null && (
          <span className="font-medium text-black/60">
            {" "}
            · credits <Hours seconds={ship.secondarySeconds} />
          </span>
        )}
      </p>
      {ship.secondaryNote && <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-black/60">{ship.secondaryNote}</p>}
    </div>
  );
}

function ScanSummary({ checks }: { checks: Check[] }) {
  const flagged = checks.filter((c) => c.status !== "pass");
  const passed = checks.length - flagged.length;
  return (
    <div className="rounded-[10px] border-2 border-panel-border bg-white px-4 py-3">
      <p className="label mb-1">pre-ship scan</p>
      {flagged.length === 0 ? (
        <p className="text-sm font-semibold">all {passed} checks passed</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {flagged.map((c) => (
            <li key={c.id} className="text-sm leading-snug">
              <span className={`mr-2 font-pixel ${c.status === "warn" ? "" : "text-black/40"}`}>{c.status === "warn" ? "note" : c.status === "skip" ? "skipped" : "failed"}</span>
              <span className="font-semibold">{c.label}</span>
              {c.detail && <span className="block font-medium text-black/60">{c.detail}</span>}
            </li>
          ))}
          {passed > 0 && <li className="text-sm font-medium text-black/50">{passed} passed</li>}
        </ul>
      )}
    </div>
  );
}
