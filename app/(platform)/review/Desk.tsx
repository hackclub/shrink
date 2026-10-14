import { AlertTriangle, CheckCircle2, CircleCheck, ExternalLink, FolderGit2, Inbox, Lock, MinusCircle, ShieldAlert, XCircle } from "lucide-react";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/app/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/components/ui/avatar";
import { Badge } from "@/app/components/ui/badge";
import { Hours, when } from "@/app/components/ui/bits";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Separator } from "@/app/components/ui/separator";
import { BADGE_BY_SLUG, MAX_URI_BYTES, capFor } from "@/lib/program";
import type { Check } from "@/lib/scan";
import type { Ship, User } from "@/lib/server/db/schema";
import { FRAUD_MESSAGE, type QueueItem } from "@/lib/server/ships";
import { cn } from "@/lib/utils";

import ClaimKeeper from "./ClaimKeeper";
import { FILTER_LABEL, SECONDARY_FILTERS, secondaryOf, type SecondaryFilter } from "./filter";
import DecisionForm from "./DecisionForm";
import Preview from "./Preview";

export type DeskProps = {
  base?: string;
  reviewer: User;
  queue: QueueItem[];
  filter: SecondaryFilter;
  // Per-filter counts; null hides the filter (reviewers, who only see passed ships).
  counts: Record<SecondaryFilter, number> | null;
  current: QueueItem | null;
  showDone: boolean;
  decided?: string;
  lockedBy: string | null;
  holder: (q: QueueItem) => string | null;
  next: QueueItem | null;
  elsewhere: QueueItem | null;
  live: { name: string; seconds: number }[] | null;
  liveSeconds: number | null;
};

// The desk itself, with no data fetching, so it can be previewed with fake ships.
export default function Desk({ base = "/review", reviewer, queue, filter, counts, current, showDone, decided, lockedBy, holder, next, elsewhere, live, liveSeconds }: DeskProps) {
  const isAdmin = reviewer.role === "admin";
  const query = (p: { s?: string; tab?: boolean; f?: SecondaryFilter }) => {
    const q = new URLSearchParams();
    if (p.s) q.set("s", p.s);
    if (p.tab) q.set("tab", "done");
    if (p.f && p.f !== "all") q.set("f", p.f);
    const str = q.toString();
    return str ? `${base}?${str}` : base;
  };
  const href = (id: string) => query({ s: id, tab: showDone, f: filter });

  return (
    <div className="desk flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Review</h1>
          <p className="text-sm text-muted-foreground">
            {showDone
              ? "Everything already decided, newest first."
              : counts
                ? `${queue.length} waiting, oldest first.`
                : `${queue.length} waiting, oldest first. You only see ships that passed the secondary check.`}
          </p>
        </div>
        <nav className="inline-flex h-9 items-center rounded-lg bg-muted p-[3px] text-sm font-medium">
          <TabLink href={query({ f: filter })} active={!showDone}>
            Queue
          </TabLink>
          <TabLink href={query({ tab: true, f: filter })} active={showDone}>
            Decided
          </TabLink>
        </nav>
      </div>

      {decided && (
        <Alert>
          <CircleCheck />
          <AlertTitle>{decided === "held" ? "Approved, pending the secondary check" : "Decision sent"}</AlertTitle>
          <AlertDescription>
            {decided === "held" ? "BITES and the DM go out once the secondary check passes." : "The author gets a Slack DM."}
          </AlertDescription>
        </Alert>
      )}

      {counts && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Secondary check</span>
          {SECONDARY_FILTERS.map((x) => (
            <Link
              key={x}
              href={query({ tab: showDone, f: x })}
              prefetch={false}
              aria-current={filter === x ? "true" : undefined}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                filter === x ? "border-primary bg-primary text-primary-foreground" : "bg-white hover:bg-muted",
              )}
            >
              {FILTER_LABEL[x]}
              <span className={cn("font-mono", filter === x ? "text-primary-foreground/60" : "text-muted-foreground")}>{counts[x]}</span>
            </Link>
          ))}
        </div>
      )}

      {queue.length === 0 ? (
        <Card className="items-center py-16 text-center">
          <Inbox className="size-8 text-muted-foreground" />
          <div>
            <p className="font-medium">{filter !== "all" ? `Nothing here with the secondary check ${FILTER_LABEL[filter].toLowerCase()}` : showDone ? "Nothing decided yet" : "Queue's empty"}</p>
            <p className="text-sm text-muted-foreground">
              {!counts ? "Ships show up once the secondary check passes them." : showDone ? "Decisions show up here." : "Nothing's waiting. Go touch grass."}
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Card className="gap-0 overflow-hidden py-0 lg:sticky lg:top-4">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-medium">{showDone ? "Decided" : "Queue"}</span>
              <span className="font-mono text-xs text-muted-foreground">{queue.length}</span>
            </div>
            <ol className="flex max-h-[70svh] flex-col overflow-y-auto p-1.5">
              {queue.map((q) => {
                const active = current?.ship.id === q.ship.id;
                const by = holder(q);
                return (
                  <li key={q.ship.id}>
                    <Link
                      href={href(q.ship.id)}
                      prefetch={false}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex flex-col gap-1 rounded-md px-3 py-2.5 transition-colors",
                        active ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                        by && !active && "opacity-60",
                      )}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium">{q.ship.title}</span>
                        <span className={cn("font-mono text-xs", active ? "text-primary-foreground/60" : "text-muted-foreground")}>#{q.ship.number}</span>
                      </span>
                      <span className={cn("flex items-center justify-between gap-2 text-xs", active ? "text-primary-foreground/70" : "text-muted-foreground")}>
                        <span className="truncate">{by ? <><Lock className="mr-1 inline size-3 align-[-1px]" />{by}</> : q.author.displayName}</span>
                        <span className="flex items-center gap-1.5">
                          {counts && filter === "all" && !showDone && <SecondaryDot ship={q.ship} />}
                          {showDone || q.ship.secondaryState === "failed" ? <ShipBadge ship={q.ship} /> : <Hours seconds={q.ship.claimedSeconds} />}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </Card>

          {!current ? (
            <Card className="items-center py-16 text-center text-sm text-muted-foreground">Pick a ship from the list.</Card>
          ) : (
            <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
              <div className="flex min-w-0 flex-col gap-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-xl font-semibold tracking-tight">{current.ship.title}</h2>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                      <span className="font-mono">#{current.ship.number}</span>
                      <span aria-hidden>·</span>
                      <span>Shipped {when(current.ship.createdAt)}</span>
                      <span aria-hidden>·</span>
                      <span className={cn("font-mono", current.ship.bytes > MAX_URI_BYTES && "text-destructive")}>
                        {current.ship.bytes.toLocaleString()} / {MAX_URI_BYTES.toLocaleString()} B
                      </span>
                      {current.ship.reshipOf && <Badge variant="outline">Re-ship</Badge>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ShipBadge ship={current.ship} />
                    {current.ship.sourceUrl && (
                      <Button asChild variant="outline" size="sm">
                        <a href={current.ship.sourceUrl} target="_blank" rel="noreferrer">
                          <FolderGit2 />
                          {/^https:\/\/(www\.)?github\.com\//i.test(current.ship.sourceUrl) ? "Open on GitHub" : "Open repo"}
                          <ExternalLink className="text-muted-foreground" />
                        </a>
                      </Button>
                    )}
                  </div>
                </div>

                <Preview key={current.ship.id} uri={current.ship.dataUri} title={current.ship.title} />

                <Card className="gap-4">
                  <CardHeader>
                    <CardTitle>Description</CardTitle>
                    <CardDescription>What the author wrote when they shipped.</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{current.ship.description}</p>
                    {current.ship.sourceUrl && (
                      <>
                        <Separator />
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-muted-foreground">Source</span>
                          <ExtLink href={current.ship.sourceUrl} className="min-w-0 truncate font-mono text-xs">
                            {current.ship.sourceUrl.replace(/^https:\/\//, "")}
                          </ExtLink>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="flex flex-col gap-6">
                <Card className="gap-0 py-0">
                  <Section title="Author">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-9">
                        {current.author.avatarUrl && <AvatarImage src={current.author.avatarUrl} alt="" />}
                        <AvatarFallback>{current.author.displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{current.author.displayName}</p>
                        <p className="truncate text-xs text-muted-foreground">{current.author.email}</p>
                      </div>
                      <Eligibility value={current.author.eligibility} />
                    </div>
                    {current.author.slackId && (
                      <div className="mt-3 flex gap-4 text-sm">
                        <ExtLink href={`https://hackclub.slack.com/team/${current.author.slackId}`}>Slack</ExtLink>
                      </div>
                    )}
                  </Section>
                  <Separator />
                  <Section title="Hackatime">
                    <ul className="flex flex-col gap-1.5 text-sm">
                      {current.ship.hackatimeProjects.map((p) => (
                        <li key={p} className="flex justify-between gap-3">
                          <span className="truncate font-mono text-xs leading-5">{p}</span>
                          <span className="text-muted-foreground">{live ? <Hours seconds={live.find((x) => x.name === p)?.seconds ?? 0} /> : "—"}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Stat label="Claimed at ship">
                        <Hours seconds={current.ship.claimedSeconds} />
                      </Stat>
                      <Stat label="Now">{liveSeconds !== null ? <Hours seconds={liveSeconds} /> : "—"}</Stat>
                    </div>
                  </Section>
                  <Separator />
                  <Section title="Checks">
                    <div className="flex flex-col gap-3">
                      {current.ship.scan ? <ScanSummary checks={current.ship.scan} /> : <p className="text-sm text-muted-foreground">No pre-ship scan.</p>}
                      <SecondarySummary ship={current.ship} />
                    </div>
                  </Section>
                </Card>

                <Outcome base={base} filter={filter} current={current} reviewer={reviewer} lockedBy={lockedBy} next={next} elsewhere={elsewhere} isAdmin={isAdmin} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// The right-hand card under the details: the form if this reviewer can decide it now,
// otherwise why not (someone else has it, waiting on a check, already decided).
function Outcome({
  base,
  filter,
  current,
  reviewer,
  lockedBy,
  next,
  elsewhere,
  isAdmin,
}: {
  base: string;
  filter: SecondaryFilter;
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
      <Card className="gap-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="size-4" />
            {lockedBy} is reviewing this
          </CardTitle>
          <CardDescription>Only one reviewer works a ship at a time. It frees up if they leave without deciding.</CardDescription>
        </CardHeader>
        {elsewhere && (
          <CardContent>
            <Button asChild variant="outline" className="w-full">
              <Link href={`${base}?s=${elsewhere.ship.id}`} prefetch={false}>
                Open #{elsewhere.ship.number} instead
              </Link>
            </Button>
          </CardContent>
        )}
      </Card>
    );
  }

  if (failed && !isAdmin) {
    return (
      <Alert variant="destructive">
        <ShieldAlert />
        <AlertTitle>Failed the fraud check</AlertTitle>
        <AlertDescription>An admin reads the note and sends it back.</AlertDescription>
      </Alert>
    );
  }

  if (ship.state === "pending" && (failed || !ship.verdict)) {
    return (
      <>
        {(author.id !== reviewer.id || isAdmin) && <ClaimKeeper shipId={ship.id} />}
        <DecisionForm
          key={ship.id}
          shipId={ship.id}
          nextId={next?.ship.id ?? ""}
          filter={filter}
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
  const approved = ship.state === "approved" || ship.state === "pending";

  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center justify-between gap-3 border-b px-6 py-4">
        <ShipBadge ship={ship} />
        {v.at && <span className="text-xs text-muted-foreground">{when(v.at)}</span>}
      </div>
      {approved && (
        <div className="flex items-end justify-between gap-3 border-b px-6 py-4">
          <div>
            <p className="font-mono text-2xl font-semibold tabular-nums">+{v.bites}</p>
            <p className="text-xs text-muted-foreground">BITES</p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p>
              <Hours seconds={v.seconds} /> · cap {capFor(v.badges)}
            </p>
            <p>{v.badges.map((b) => BADGE_BY_SLUG.get(b)?.title).join(", ") || "No badges"}</p>
          </div>
        </div>
      )}
      <Section title="Message to the author">
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{v.message}</p>
      </Section>
      {v.note && (
        <>
          <Separator />
          <Section title="Justification">
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{v.note}</p>
          </Section>
        </>
      )}
      {ship.state === "pending" && (
        <div className="border-t bg-muted/50 px-6 py-3 text-xs text-muted-foreground">
          The author still sees this as in review. It lands once the secondary check passes. If it fails, it comes back to the queue for an admin.
        </div>
      )}
    </Card>
  );
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={cn("rounded-md px-3 py-1 transition-colors", active ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
    >
      {children}
    </Link>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-6 py-4">
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-muted/60 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{children}</p>
    </div>
  );
}

function ExtLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline", className)}>
      <span className="truncate">{children}</span>
      <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
    </a>
  );
}

function Eligibility({ value }: { value: string }) {
  if (value === "eligible") return <Badge variant="secondary">Eligible</Badge>;
  return (
    <Badge variant="outline" className="border-destructive/40 text-destructive">
      {value.replace(/_/g, " ")}
    </Badge>
  );
}

// "Approved" here would be a lie until the held approval lands.
function ShipBadge({ ship }: { ship: Ship }) {
  if (ship.state === "pending" && ship.secondaryState === "failed") return <Badge variant="destructive">Fraud</Badge>;
  if (ship.state === "pending" && ship.verdict) return <Badge variant="outline">Held</Badge>;
  if (ship.state === "approved") return <Badge className="bg-brand text-black">Approved</Badge>;
  if (ship.state === "rejected") return <Badge variant="secondary">Sent back</Badge>;
  return <Badge variant="outline">In review</Badge>;
}

const DOT: Record<string, string> = { passed: "bg-emerald-500", waiting: "bg-amber-400", failed: "bg-destructive", unsent: "bg-neutral-300" };

function SecondaryDot({ ship }: { ship: Ship }) {
  const s = secondaryOf(ship);
  return <span title={`Secondary check: ${FILTER_LABEL[s].toLowerCase()}`} className={cn("size-2 rounded-full", DOT[s])} />;
}

// Internal only: authors never see that a second check exists.
function SecondarySummary({ ship }: { ship: Ship }) {
  if (!ship.secondaryState) return null;
  const failed = ship.secondaryState === "failed";
  return (
    <div className={cn("rounded-md border px-3 py-2.5", failed && "border-destructive/40 bg-destructive/5")}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">Secondary check</span>
        <span className={cn("flex items-center gap-1.5", failed ? "text-destructive" : "text-muted-foreground")}>
          {ship.secondaryState === "passed" ? <CheckCircle2 className="size-4 text-emerald-600" /> : failed ? <XCircle className="size-4" /> : null}
          {{ waiting: "Waiting", passed: "Passed", failed: "Failed" }[ship.secondaryState]}
          {ship.secondaryScore != null && <span className="font-mono text-xs">{ship.secondaryScore}/10</span>}
        </span>
      </div>
      {ship.secondarySeconds != null && (
        <p className="mt-1 text-xs text-muted-foreground">
          Credits <Hours seconds={ship.secondarySeconds} />
        </p>
      )}
      {ship.secondaryNote && <p className="mt-1.5 text-sm whitespace-pre-wrap text-muted-foreground">{ship.secondaryNote}</p>}
    </div>
  );
}

const CHECK_ICON = {
  pass: <CheckCircle2 className="size-4 text-emerald-600" />,
  warn: <AlertTriangle className="size-4 text-amber-600" />,
  fail: <XCircle className="size-4 text-destructive" />,
  skip: <MinusCircle className="size-4 text-muted-foreground" />,
};

function ScanSummary({ checks }: { checks: Check[] }) {
  const flagged = checks.filter((c) => c.status !== "pass");
  const passed = checks.length - flagged.length;
  return (
    <div className="rounded-md border px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">Pre-ship scan</span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {CHECK_ICON.pass}
          {passed}/{checks.length} passed
        </span>
      </div>
      {flagged.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2 border-t pt-2">
          {flagged.map((c) => (
            <li key={c.id} className="flex gap-2 text-sm">
              <span className="mt-0.5">{CHECK_ICON[c.status]}</span>
              <span className="min-w-0">
                <span className="font-medium">{c.label}</span>
                {c.detail && <span className="block text-xs text-muted-foreground">{c.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
