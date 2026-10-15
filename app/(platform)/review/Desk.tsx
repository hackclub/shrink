import { Check, ExternalLink, Lock } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/app/components/ui/avatar";
import { Hours, when } from "@/app/components/ui/bits";
import { BADGE_BY_SLUG, MAX_URI_BYTES, capFor } from "@/lib/program";
import type { Check as ScanCheck } from "@/lib/scan";
import type { RepoView } from "@/lib/server/scan";
import type { Ship, User } from "@/lib/server/db/schema";
import { FRAUD_MESSAGE, awaitingCheck, verdictKind, type QueueItem, type QueueTab } from "@/lib/server/ships";
import { publicName } from "@/lib/server/users";
import { cn } from "@/lib/utils";

import ClaimKeeper from "./ClaimKeeper";
import { FILTER_LABEL, SECONDARY_FILTERS, secondaryOf, type SecondaryFilter } from "./filter";
import DecisionForm from "./DecisionForm";
import QueueLink from "./QueueLink";
import { ReplayMark } from "./Recorder";
import Workspace from "./Workspace";

export type DeskProps = {
  base?: string;
  reviewer: User;
  queue: QueueItem[];
  filter: SecondaryFilter;
  // Per-filter counts; null hides the filter (reviewers, who only see passed ships).
  counts: Record<SecondaryFilter, number> | null;
  current: QueueItem | null;
  // "check" is the admins' second pass over reviewers' calls.
  tab: QueueTab;
  decided?: string;
  lockedBy: string | null;
  holder: (q: QueueItem) => string | null;
  next: QueueItem | null;
  elsewhere: QueueItem | null;
  // Streamed: the desk shows without waiting on Hackatime or GitHub.
  live: Promise<{ name: string; seconds: number }[] | null>;
  repo: Promise<RepoView | null>;
};

// The desk itself, with no data fetching of its own, so it can be previewed with fake ships.
// On wide screens it fills the viewport: queue, workspace and inspector each scroll on their own.
export default function Desk({ base = "/review", reviewer, queue, filter, counts, current, tab, decided, lockedBy, holder, next, elsewhere, live, repo }: DeskProps) {
  const isAdmin = reviewer.role === "admin";
  const showDone = tab === "done";
  const query = (p: { s?: string; tab?: QueueTab; f?: SecondaryFilter }) => {
    const q = new URLSearchParams();
    if (p.s) q.set("s", p.s);
    if (p.tab && p.tab !== "queue") q.set("tab", p.tab);
    if (p.f && p.f !== "all") q.set("f", p.f);
    const str = q.toString();
    return str ? `${base}?${str}` : base;
  };
  const href = (id: string) => query({ s: id, tab, f: filter });
  const idx = current ? queue.findIndex((q) => q.ship.id === current.ship.id) : -1;
  const prevHref = idx > 0 ? href(queue[idx - 1].ship.id) : null;
  const nextHref = idx >= 0 && idx < queue.length - 1 ? href(queue[idx + 1].ship.id) : null;

  return (
    <div className="desk grid grid-cols-1 border bg-white text-sm lg:-mx-[var(--gutter)] lg:-mt-[clamp(1.5rem,3vw,48px)] lg:min-h-0 lg:flex-1 lg:grid-cols-[256px_minmax(0,1fr)_360px] lg:border-x-0 lg:border-t-0 2xl:grid-cols-[288px_minmax(0,1fr)_420px]">
      {/* Queue */}
      <aside className="flex min-h-0 flex-col border-b lg:border-r lg:border-b-0">
        <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
          <TabLink href={query({ f: filter })} active={tab === "queue"}>
            Queue
          </TabLink>
          {isAdmin && (
            <TabLink href={query({ tab: "check", f: filter })} active={tab === "check"}>
              Second pass
            </TabLink>
          )}
          <TabLink href={query({ tab: "done", f: filter })} active={showDone}>
            Decided
          </TabLink>
          <span className="ml-auto pr-1 font-mono text-xs text-muted-foreground">{queue.length}</span>
        </div>
        {counts && (
          <div className="flex shrink-0 flex-wrap gap-x-0.5 gap-y-1 border-b px-2 py-1.5">
            {SECONDARY_FILTERS.map((x) => (
              <Link
                key={x}
                href={query({ tab, f: x })}
                prefetch={false}
                aria-current={filter === x ? "true" : undefined}
                title={x === "all" ? "Every ship" : `Secondary check: ${FILTER_LABEL[x].toLowerCase()}`}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded px-1.5 text-xs transition-colors",
                  filter === x ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {x !== "all" && <span className={cn("size-1.5 rounded-full", DOT[x])} />}
                {FILTER_LABEL[x]}
                <span className="font-mono opacity-60">{counts[x]}</span>
              </Link>
            ))}
          </div>
        )}
        {queue.length === 0 ? (
          <p className="px-4 py-6 text-muted-foreground">
            {filter !== "all"
              ? `Nothing with the secondary check ${FILTER_LABEL[filter].toLowerCase()}.`
              : showDone
                ? "Nothing decided yet."
                : tab === "check"
                  ? "Nothing waiting on a second pass."
                : !counts
                  ? "Empty. Ships show up here once the secondary check passes them."
                  : "Queue's empty."}
          </p>
        ) : (
          <ol className="max-h-[40svh] min-h-0 flex-1 overflow-y-auto lg:max-h-none">
            {queue.map((q) => {
              const active = current?.ship.id === q.ship.id;
              const by = holder(q);
              return (
                <li key={q.ship.id} className="border-b last:border-b-0">
                  <QueueLink href={href(q.ship.id)} active={active} dimmed={!!by && !active}>
                    <span className="flex items-baseline gap-2">
                      {counts && filter === "all" && tab !== "done" && <SecondaryDot ship={q.ship} />}
                      <span className="min-w-0 flex-1 truncate font-medium">{q.ship.title}</span>
                      <span className="font-mono text-xs text-muted-foreground">#{q.ship.number}</span>
                    </span>
                    <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="min-w-0 truncate">
                        {by ? (
                          <>
                            <Lock className="mr-1 inline size-3 align-[-1px]" />
                            {by}
                          </>
                        ) : (
                          publicName(q.author)
                        )}
                      </span>
                      {tab !== "queue" || q.ship.secondaryState === "failed" ? <StateText ship={q.ship} isAdmin={isAdmin} /> : <Hours seconds={q.ship.claimedSeconds} />}
                    </span>
                  </QueueLink>
                </li>
              );
            })}
          </ol>
        )}
        <p className="hidden shrink-0 border-t px-3 py-1.5 text-xs text-muted-foreground lg:block">
          <Kbd>J</Kbd> <Kbd>K</Kbd> next / prev · <Kbd>1</Kbd>–<Kbd>4</Kbd> tabs
        </p>
      </aside>

      {!current ? (
        <div className="flex min-h-48 items-center justify-center text-muted-foreground lg:col-span-2">{queue.length ? "Pick a ship." : null}</div>
      ) : (
        <>
          {/* Workspace */}
          <section className="flex min-h-0 min-w-0 flex-col border-b lg:border-b-0">
            {decided && (
              <p role="status" className="flex shrink-0 items-center gap-1.5 border-b bg-emerald-50 px-4 py-1.5 text-xs text-emerald-800">
                <Check className="size-3.5" />
                {decided === "held" ? "Approved. BITES and the DM go out once the secondary check passes." : "Decision sent. The author gets a Slack DM."}
              </p>
            )}
            <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5">
              <ReplayMark shipId={current.ship.id} number={current.ship.number} reviewing={!showDone && current.ship.state === "pending"} />
              <h1 className="min-w-0 truncate text-base font-semibold tracking-tight">{current.ship.title}</h1>
              <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span className="font-mono">#{current.ship.number}</span>
                <span aria-hidden>·</span>
                <span>{when(current.ship.createdAt)}</span>
                <span aria-hidden>·</span>
                <span className={cn("font-mono", current.ship.bytes > MAX_URI_BYTES && "font-medium text-destructive")}>
                  {current.ship.bytes.toLocaleString()} B
                </span>
                {current.ship.reshipOf && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="font-medium text-foreground">Re-ship</span>
                  </>
                )}
              </span>
              <span className="ml-auto flex items-center gap-3">
                <StateText ship={current.ship} isAdmin={isAdmin} />
                {current.ship.sourceUrl && (
                  <ExtLink href={current.ship.sourceUrl} className="text-xs">
                    {current.ship.sourceUrl.replace(/^https:\/\/(www\.)?/, "").replace(/^github\.com\//, "")}
                  </ExtLink>
                )}
              </span>
            </header>
            <Workspace
              key={current.ship.id}
              shipId={current.ship.id}
              uri={current.ship.dataUri}
              title={current.ship.title}
              repo={current.ship.sourceUrl ? repo : null}
              prevHref={prevHref}
              nextHref={nextHref}
            />
          </section>

          {/* Inspector */}
          <aside className="flex min-h-0 flex-col lg:overflow-y-auto lg:border-l">
            <Block>
              <div className="flex items-center gap-2.5">
                <Avatar className="size-8">
                  {current.author.avatarUrl && <AvatarImage src={current.author.avatarUrl} alt="" />}
                  <AvatarFallback className="text-xs">{(current.author.slackHandle ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{publicName(current.author)}</p>
                </div>
                {current.author.slackId && (
                  <ExtLink href={`https://hackclub.slack.com/team/${current.author.slackId}`} className="text-xs">
                    Slack
                  </ExtLink>
                )}
              </div>
              {current.author.eligibility !== "eligible" && (
                <p className="mt-2 rounded bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">{current.author.eligibility.replace(/_/g, " ")}</p>
              )}
            </Block>

            {current.ship.description && (
              <Block label="Description">
                <p className="leading-relaxed whitespace-pre-wrap">{current.ship.description}</p>
              </Block>
            )}

            <Block label="Time">
              <Suspense fallback={<TimeRows ship={current.ship} live={undefined} />}>
                <LiveTime ship={current.ship} live={live} />
              </Suspense>
            </Block>

            <Block label="Checks">
              <div className="flex flex-col gap-2">
                {current.ship.scan ? <ScanSummary checks={current.ship.scan} /> : <p className="text-muted-foreground">No pre-ship scan.</p>}
                <SecondarySummary ship={current.ship} />
              </div>
            </Block>

            <Outcome base={base} filter={filter} tab={tab} current={current} reviewer={reviewer} lockedBy={lockedBy} next={next} elsewhere={elsewhere} isAdmin={isAdmin} />
          </aside>
        </>
      )}
    </div>
  );
}

// The bottom of the inspector: the form if this reviewer can decide it now,
// otherwise why not (someone else has it, waiting on a check, already decided).
function Outcome({
  base,
  filter,
  tab,
  current,
  reviewer,
  lockedBy,
  next,
  elsewhere,
  isAdmin,
}: {
  base: string;
  filter: SecondaryFilter;
  tab: QueueTab;
  current: QueueItem;
  reviewer: User;
  lockedBy: string | null;
  next: QueueItem | null;
  elsewhere: QueueItem | null;
  isAdmin: boolean;
}) {
  const { ship, author } = current;
  const failed = ship.state === "pending" && ship.secondaryState === "failed";

  if (ship.state === "pending" && lockedBy) {
    return (
      <Block>
        <p className="flex items-center gap-1.5 font-medium">
          <Lock className="size-3.5" />
          {lockedBy} is reviewing this
        </p>
        <p className="mt-1 text-xs text-muted-foreground">It frees up if they leave without deciding.</p>
        {elsewhere && (
          <Link href={`${base}?s=${elsewhere.ship.id}`} prefetch={false} className="mt-2 inline-block text-xs font-medium underline underline-offset-4">
            Open #{elsewhere.ship.number} instead
          </Link>
        )}
      </Block>
    );
  }

  if (failed && !isAdmin) {
    return (
      <Block>
        <p className="font-medium text-destructive">Failed the fraud check</p>
        <p className="mt-1 text-xs text-muted-foreground">An admin reads the note and sends it back.</p>
      </Block>
    );
  }

  // The second pass: the reviewer's call, prefilled, for an admin to confirm or change.
  const check = isAdmin && !failed && awaitingCheck(ship) ? ship.verdict : null;
  if (ship.state === "pending" && (failed || !ship.verdict || check)) {
    return (
      <>
        {(author.id !== reviewer.id || isAdmin) && <ClaimKeeper shipId={ship.id} />}
        {check && (
          <Block label={`Reviewer's call · ${when(new Date(check.at))}`}>
            <p className="text-xs text-muted-foreground">Confirm it as is, or change anything before it goes out. The author hears nothing until you do.</p>
            {check.internalNote && <p className="mt-1.5 leading-relaxed whitespace-pre-wrap text-muted-foreground">{check.internalNote}</p>}
          </Block>
        )}
        <DecisionForm
          key={ship.id}
          shipId={ship.id}
          nextId={next?.ship.id ?? ""}
          filter={filter}
          tab={tab}
          prior={check ? { kind: verdictKind(check), seconds: check.awardedSeconds, badges: check.badges, message: check.message } : undefined}
          claimedSeconds={ship.claimedSeconds}
          claimedBadges={ship.claimedBadges}
          isOwn={author.id === reviewer.id && !isAdmin}
          fraudMessage={failed ? FRAUD_MESSAGE : undefined}
        />
      </>
    );
  }

  const v =
    ship.state === "pending" && ship.verdict
      ? { at: new Date(ship.verdict.at), bites: ship.verdict.bites, seconds: ship.verdict.awardedSeconds, badges: ship.verdict.badges, message: ship.verdict.message, note: ship.verdict.internalNote }
      : {
          at: ship.reviewedAt,
          bites: ship.awardedBites ?? 0,
          seconds: ship.awardedSeconds ?? 0,
          badges: ship.awardedBadges ?? [],
          message: ship.publicMessage,
          note: ship.internalNote,
        };
  const approved = ship.state === "approved" || (ship.state === "pending" && !!ship.verdict && verdictKind(ship.verdict) === "approve");

  return (
    <>
      <Block label={v.at ? `Decision · ${when(v.at)}` : "Decision"}>
        {approved ? (
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-mono text-xl font-semibold tabular-nums">
              +{v.bites} <span className="text-xs font-normal text-muted-foreground">BITES</span>
            </p>
            <p className="text-right text-xs text-muted-foreground">
              <Hours seconds={v.seconds} /> · cap {capFor(v.badges)}
              <br />
              {v.badges.map((b) => BADGE_BY_SLUG.get(b)?.title).join(", ") || "No badges"}
            </p>
          </div>
        ) : (
          <StateText ship={ship} isAdmin={isAdmin} />
        )}
        {ship.state === "pending" && (isAdmin || !awaitingCheck(ship)) && (
          <p className="mt-2 text-xs text-muted-foreground">
            {awaitingCheck(ship)
              ? "Held: the author sees it as in review until an admin gives it a second pass."
              : "Held: the author sees it as in review until the secondary check passes. If it fails, it comes back for an admin."}
          </p>
        )}
      </Block>
      <Block label="Message to the author">
        <p className="leading-relaxed whitespace-pre-wrap">{v.message}</p>
      </Block>
      {v.note && (
        <Block label="Justification">
          <p className="leading-relaxed whitespace-pre-wrap text-muted-foreground">{v.note}</p>
        </Block>
      )}
    </>
  );
}

async function LiveTime({ ship, live }: { ship: Ship; live: DeskProps["live"] }) {
  return <TimeRows ship={ship} live={await live} />;
}

// live: undefined while Hackatime is loading, null if it didn't answer (or the ship is decided).
function TimeRows({ ship, live }: { ship: Ship; live: { name: string; seconds: number }[] | null | undefined }) {
  const now = live ? live.filter((p) => ship.hackatimeProjects.includes(p.name)).reduce((a, p) => a + p.seconds, 0) : null;
  const dash = <span className={cn(live === undefined && "animate-pulse")}>—</span>;
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Claimed at ship</p>
          <p className="font-medium">
            <Hours seconds={ship.claimedSeconds} />
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Hackatime now</p>
          <p className={cn("font-medium", now !== null && now < ship.claimedSeconds && "text-destructive")}>{now !== null ? <Hours seconds={now} /> : dash}</p>
        </div>
      </div>
      <ul className="mt-2 flex flex-col gap-0.5">
        {ship.hackatimeProjects.map((p) => (
          <li key={p} className="flex justify-between gap-3 text-xs">
            <span className="truncate font-mono">{p}</span>
            <span className="text-muted-foreground">{live ? <Hours seconds={live.find((x) => x.name === p)?.seconds ?? 0} /> : dash}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Block({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <section className="border-b px-4 py-3">
      {label && <h2 className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</h2>}
      {children}
    </section>
  );
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      className={cn("rounded px-2 py-1 font-medium transition-colors", active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
    >
      {children}
    </Link>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border bg-muted px-1 font-mono text-[0.7rem] text-foreground">{children}</kbd>;
}

function ExtLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cn("inline-flex min-w-0 items-center gap-1 font-medium underline-offset-4 hover:underline", className)}>
      <span className="truncate">{children}</span>
      <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
    </a>
  );
}

// "Approved" here would be a lie until the held approval lands. Reviewers never see
// the second pass: to them a call waiting on it reads as done.
function StateText({ ship, isAdmin }: { ship: Ship; isAdmin: boolean }) {
  const [label, tone] =
    ship.state === "pending" && ship.secondaryState === "failed"
      ? ["Fraud", "text-destructive"]
      : awaitingCheck(ship)
        ? verdictKind(ship.verdict!) === "reject"
          ? [isAdmin ? "Send back?" : "Sent back", isAdmin ? "text-amber-700" : "text-muted-foreground"]
          : [isAdmin ? "Approve?" : "Approved", isAdmin ? "text-amber-700" : "text-emerald-700"]
        : ship.state === "pending" && ship.verdict
          ? ["Held", "text-amber-700"]
          : ship.state === "approved"
            ? ["Approved", "text-emerald-700"]
            : ship.state === "rejected"
              ? ["Sent back", "text-muted-foreground"]
              : ["In review", "text-muted-foreground"];
  return <span className={cn("text-xs font-medium", tone)}>{label}</span>;
}

const DOT: Record<string, string> = { passed: "bg-emerald-500", waiting: "bg-amber-400", failed: "bg-destructive", unsent: "bg-neutral-300" };

function SecondaryDot({ ship }: { ship: Ship }) {
  const s = secondaryOf(ship);
  return <span title={`Secondary check: ${FILTER_LABEL[s].toLowerCase()}`} className={cn("size-1.5 shrink-0 translate-y-[-2px] rounded-full", DOT[s])} />;
}

// Internal only: authors never see that a second check exists.
function SecondarySummary({ ship }: { ship: Ship }) {
  if (!ship.secondaryState) return null;
  const failed = ship.secondaryState === "failed";
  return (
    <div className={cn(failed && "-mx-2 rounded bg-destructive/5 px-2 py-1.5")}>
      <p className="flex items-center justify-between gap-2">
        <span>Secondary check</span>
        <span className={cn("text-xs font-medium", failed ? "text-destructive" : ship.secondaryState === "passed" ? "text-emerald-700" : "text-muted-foreground")}>
          {{ waiting: "Waiting", passed: "Passed", failed: "Failed" }[ship.secondaryState]}
          {ship.secondaryScore != null && <span className="ml-1.5 font-mono">{ship.secondaryScore}/10</span>}
          {ship.secondarySeconds != null && (
            <span className="ml-1.5 font-normal text-muted-foreground">
              · <Hours seconds={ship.secondarySeconds} />
            </span>
          )}
        </span>
      </p>
      {ship.secondaryNote && <p className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground">{ship.secondaryNote}</p>}
    </div>
  );
}

const CHECK_TONE = { pass: "text-emerald-700", warn: "text-amber-700", fail: "text-destructive", skip: "text-muted-foreground" };

function ScanSummary({ checks }: { checks: ScanCheck[] }) {
  const flagged = checks.filter((c) => c.status !== "pass");
  return (
    <div>
      <p className="flex items-center justify-between gap-2">
        <span>Pre-ship scan</span>
        <span className={cn("font-mono text-xs font-medium", flagged.some((c) => c.status === "fail") ? "text-destructive" : flagged.length ? "text-amber-700" : "text-emerald-700")}>
          {checks.length - flagged.length}/{checks.length}
        </span>
      </p>
      {flagged.length > 0 && (
        <ul className="mt-1 flex flex-col gap-1">
          {flagged.map((c) => (
            <li key={c.id} className="text-xs">
              <span className={cn("mr-1.5 font-medium uppercase", CHECK_TONE[c.status])}>{c.status}</span>
              <span className="font-medium">{c.label}</span>
              {c.detail && <span className="block text-muted-foreground">{c.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
