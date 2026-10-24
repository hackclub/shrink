"use client";

import { Check, ChevronDown, Copy, ExternalLink, Eye, Layers, Loader2, Search, Send, UserRound, UserRoundPlus, X } from "lucide-react";
import Image from "next/image";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/app/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/components/ui/avatar";
import { when } from "@/app/components/ui/bits";
import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import type { Address } from "@/lib/server/auth/hca";
import { cn } from "@/lib/utils";

import { orderAssignAction, orderHandleAction, refundDenyAction, revealAddressAction } from "../actions";

type State = "placed" | "fulfilled" | "rejected";

export type OrderRow = {
  id: string;
  number: number;
  rewardSlug: string;
  reward: string;
  img: { src: string; w: number; h: number } | null;
  digital: boolean;
  cost: number;
  state: State;
  note: string | null;
  internalNote: string | null;
  createdAt: string;
  handledAt: string | null;
  handler: string | null;
  assignee: Person | null;
  // Set when they asked to cancel; refundDenial is non-null once an admin said no.
  refundRequestedAt: string | null;
  refundReason: string | null;
  refundDenial: string | null;
  user: { id: string; displayName: string; email: string; slackId: string | null; slackHandle: string | null; avatarUrl: string | null };
};

type Person = { id: string; name: string };
type Who = "all" | "mine" | "unassigned" | "refunds";

type Flash = { id: string; kind: "pending" | "ok" | "error"; text: string };

const TABS: { id: State; label: string }[] = [
  { id: "placed", label: "To ship" },
  { id: "fulfilled", label: "Shipped" },
  { id: "rejected", label: "Cancelled" },
];

const DAY = 86_400_000;
// Waiting this many days turns an order amber, twice as long red.
const SLOW = 7;

const daysSince = (iso: string, now: number) => Math.max(0, Math.floor((now - Date.parse(iso)) / DAY));
const ageTone = (days: number) => (days >= SLOW * 2 ? "text-destructive" : days >= SLOW ? "text-amber-700" : "text-muted-foreground");

// A thrown action (network down, server crash) reads like any other error, not a broken page.
function failed(e: unknown): { error: string; address?: undefined } {
  unstable_rethrow(e);
  console.error("[orders]", e);
  return { error: "Couldn't reach the server. The list reloads to show whether it went through." };
}

function without<T>(o: Record<string, T>, key: string): Record<string, T> {
  const rest = { ...o };
  delete rest[key];
  return rest;
}

function addressLines(a: Address): string[] {
  const town = `${a.city}${a.region ? `, ${a.region}` : ""} ${a.postcode}`.trim();
  return [a.recipient, a.line1, a.line2, town, a.country].filter((l): l is string => Boolean(l));
}

// Fulfilment, laid out like the review desk: the queue on the left, oldest first, and the order
// on the right with everything needed to post it. Handling an order moves straight on to the next.
export default function OrdersDesk({
  rows,
  now,
  initial,
  me,
  team,
}: {
  rows: OrderRow[];
  now: number;
  initial: string | null;
  me: string;
  team: { id: string; displayName: string }[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<State>(() => rows.find((r) => r.id === initial)?.state ?? "placed");
  const [q, setQ] = useState("");
  const [reward, setReward] = useState<string | null>(null);
  const [who, setWho] = useState<Who>("all");
  const [selected, setSelected] = useState<string | null>(initial);
  // Handled here but not back from the server yet, so the queue moves on without waiting.
  const [settled, setSettled] = useState<Record<string, State>>({});
  const [flash, setFlash] = useState<Flash | null>(null);
  // Each reveal is logged, so an address stays revealed for as long as the page is open.
  const [addresses, setAddresses] = useState<Record<string, Address>>({});
  const [revealError, setRevealError] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  // Assignments made here, ahead of the server, like `settled`.
  const [assigned, setAssigned] = useState<Record<string, Person | null>>({});
  const [denied, setDenied] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();
  const search = useRef<HTMLInputElement>(null);

  const stateOf = (r: OrderRow) => settled[r.id] ?? r.state;
  const assigneeOf = (r: OrderRow) => (r.id in assigned ? assigned[r.id] : r.assignee);
  const denialOf = (r: OrderRow) => denied[r.id] ?? r.refundDenial;
  const asksRefund = (r: OrderRow) => stateOf(r) === "placed" && !!r.refundRequestedAt && denialOf(r) === null;
  const people: Person[] = team.map((t) => ({ id: t.id, name: t.id === me ? `${t.displayName} (you)` : t.displayName }));

  const counts = { placed: 0, fulfilled: 0, rejected: 0 };
  for (const r of rows) counts[stateOf(r)]++;

  const list = useMemo(() => {
    const inTab = rows.filter((r) => (settled[r.id] ?? r.state) === tab);
    const asks = (r: OrderRow) => Number(!!r.refundRequestedAt && (denied[r.id] ?? r.refundDenial) === null);
    // The queue is first come, first served, except refund requests, which hold an order up
    // until someone answers them. Handled orders read newest first.
    return tab === "placed"
      ? inTab.sort((a, b) => asks(b) - asks(a) || a.createdAt.localeCompare(b.createdAt))
      : inTab.sort((a, b) => (b.handledAt ?? b.createdAt).localeCompare(a.handledAt ?? a.createdAt));
  }, [rows, settled, denied, tab]);

  const needle = q.trim().toLowerCase().replace(/^#/, "");
  const searched = needle
    ? list.filter((r) =>
        [r.user.displayName, r.user.email, r.user.slackHandle ?? "", r.reward, String(r.number)].some((s) => s.toLowerCase().includes(needle)),
      )
    : list;
  // Assignment only means anything while an order is open.
  const mineCount = tab === "placed" ? searched.filter((r) => assigneeOf(r)?.id === me).length : 0;
  const unassignedCount = tab === "placed" ? searched.filter((r) => !assigneeOf(r)).length : 0;
  const refundCount = tab === "placed" ? searched.filter(asksRefund).length : 0;
  const forWho =
    tab !== "placed" || who === "all"
      ? searched
      : searched.filter((r) => (who === "mine" ? assigneeOf(r)?.id === me : who === "refunds" ? asksRefund(r) : !assigneeOf(r)));
  const shown = reward ? forWho.filter((r) => r.rewardSlug === reward) : forWho;

  // The pick list: how many of each prize the current view needs.
  const picks = useMemo(() => {
    const m = new Map<string, { slug: string; name: string; digital: boolean; n: number }>();
    for (const r of forWho) {
      const p = m.get(r.rewardSlug) ?? { slug: r.rewardSlug, name: r.reward, digital: r.digital, n: 0 };
      p.n++;
      m.set(r.rewardSlug, p);
    }
    return [...m.values()].sort((a, b) => Number(a.digital) - Number(b.digital) || b.n - a.n || a.name.localeCompare(b.name));
  }, [forWho]);

  // Everyone's open orders, so two things going to one person can go in one parcel.
  const openBy = useMemo(() => {
    const m = new Map<string, OrderRow[]>();
    for (const r of rows) {
      if ((settled[r.id] ?? r.state) !== "placed") continue;
      m.set(r.user.id, [...(m.get(r.user.id) ?? []), r]);
    }
    return m;
  }, [rows, settled]);

  const current = shown.find((r) => r.id === selected) ?? shown[0] ?? null;
  const idx = current ? shown.indexOf(current) : -1;

  useEffect(() => {
    const url = current ? `?o=${current.id}` : window.location.pathname;
    window.history.replaceState(null, "", url);
    if (current) document.getElementById(`order-${current.id}`)?.scrollIntoView({ block: "nearest" });
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = (key: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };

  const reveal = (row: OrderRow) => {
    if (row.digital || addresses[row.id] || revealing) return;
    const fd = new FormData();
    fd.set("order_id", row.id);
    setRevealing(row.id);
    startTransition(async () => {
      const r = await revealAddressAction({ error: null }, fd).catch(failed);
      if (r.address) setAddresses((a) => ({ ...a, [row.id]: r.address as unknown as Address }));
      else setRevealError((e) => ({ ...e, [row.id]: r.error ?? "Couldn't load the address." }));
      setRevealing(null);
    });
  };

  const act = (row: OrderRow, action: "fulfil" | "reject", note: string) => {
    const i = shown.indexOf(row);
    const next = shown[i + 1] ?? shown[i - 1] ?? null;
    const done = action === "fulfil" ? (row.digital ? "sent" : "shipped") : "cancelled and refunded";
    setSettled((s) => ({ ...s, [row.id]: action === "fulfil" ? "fulfilled" : "rejected" }));
    setSelected(next?.id ?? null);
    setFlash({ id: row.id, kind: "pending", text: `Marking #${row.number} ${done}…` });
    const fd = new FormData();
    fd.set("order_id", row.id);
    fd.set("action", action);
    fd.set("internal_note", note);
    startTransition(async () => {
      const r = await orderHandleAction({ error: null }, fd).catch(failed);
      if (r.error) {
        setSettled((s) => without(s, row.id));
        setFlash({ id: row.id, kind: "error", text: `#${row.number} wasn't changed: ${r.error}` });
        router.refresh();
      } else {
        setNotes((n) => without(n, row.id));
        setFlash({ id: row.id, kind: "ok", text: `#${row.number} ${row.reward} ${done}. ${row.user.displayName} gets a Slack DM.` });
      }
    });
  };

  const assign = (row: OrderRow, to: Person | null) => {
    const before = assigneeOf(row);
    if ((before?.id ?? null) === (to?.id ?? null)) return;
    setAssigned((a) => ({ ...a, [row.id]: to }));
    const fd = new FormData();
    fd.set("order_id", row.id);
    fd.set("assignee", to?.id ?? "");
    startTransition(async () => {
      const r = await orderAssignAction({ error: null }, fd).catch(failed);
      if (r.error) {
        setAssigned((a) => without(a, row.id));
        setFlash({ id: row.id, kind: "error", text: `Couldn't assign #${row.number}: ${r.error}` });
        router.refresh();
      }
    });
  };
  const deny = (row: OrderRow, message: string) => {
    setDenied((d) => ({ ...d, [row.id]: message }));
    const fd = new FormData();
    fd.set("order_id", row.id);
    fd.set("message", message);
    startTransition(async () => {
      const r = await refundDenyAction({ error: null }, fd).catch(failed);
      if (r.error) {
        setDenied((d) => without(d, row.id));
        setFlash({ id: row.id, kind: "error", text: `Refund on #${row.number} wasn't denied: ${r.error}` });
        router.refresh();
      } else {
        setFlash({ id: row.id, kind: "ok", text: `Refund on #${row.number} denied. ${row.user.displayName} gets a Slack DM; the order stays in the queue.` });
      }
    });
  };

  const meAsPerson = people.find((p) => p.id === me) ?? null;
  const toggleMine = (row: OrderRow) => assign(row, assigneeOf(row)?.id === me ? null : meAsPerson);

  const open = (id: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    setTab(stateOf(row));
    setQ("");
    setReward(null);
    setWho("all");
    setSelected(id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector("[role=alertdialog]")) return;
      const el = e.target as HTMLElement;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (current && stateOf(current) === "placed" && !asksRefund(current) && el !== search.current) {
          e.preventDefault();
          act(current, "fulfil", notes[current.id] ?? "");
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest("input, textarea, select, [contenteditable=true]")) return;
      const k = e.key.toLowerCase();
      const move = k === "j" || e.key === "ArrowDown" ? 1 : k === "k" || e.key === "ArrowUp" ? -1 : 0;
      if (move) {
        const to = shown[idx + move];
        if (to) setSelected(to.id);
        e.preventDefault();
      } else if (e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      } else if (k === "a" && current && stateOf(current) === "placed") {
        toggleMine(current);
      } else if (k === "r" && current) {
        reveal(current);
      } else if (k === "c" && current) {
        const a = addresses[current.id];
        if (a) copy(`all-${current.id}`, addressLines(a).join("\n"));
        else if (current.digital) copy(`email-${current.id}`, current.user.email);
      } else if (e.key >= "1" && e.key <= "3") {
        setTab(TABS[Number(e.key) - 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const oldest = tab === "placed" && list[0] ? daysSince(list[0].createdAt, now) : null;
  const filtering = Boolean(needle || reward || (tab === "placed" && who !== "all"));
  const pick = picks.find((p) => p.slug === reward);

  return (
    <div className="desk grid grid-cols-1 border bg-card text-sm lg:-mx-[var(--gutter)] lg:-mt-[clamp(1.5rem,3vw,48px)] lg:min-h-0 lg:flex-1 lg:grid-cols-[320px_minmax(0,1fr)] lg:border-x-0 lg:border-t-0 2xl:grid-cols-[360px_minmax(0,1fr)]">
      {/* Queue */}
      <aside className="flex min-h-0 flex-col border-b lg:border-r lg:border-b-0">
        <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              title={`${t.label} (${i + 1})`}
              className={cn(
                "flex items-center gap-1.5 rounded px-2 py-1 font-medium transition-colors",
                tab === t.id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              <span
                className={cn(
                  "font-mono text-xs",
                  t.id === "placed" && counts.placed > 0 ? "rounded bg-foreground px-1 text-background" : "text-muted-foreground",
                )}
              >
                {counts[t.id]}
              </span>
            </button>
          ))}
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQ("");
                  e.currentTarget.blur();
                }
              }}
              placeholder="Name, email, #number, prize"
              aria-label="Search orders"
              className="h-8 bg-background pr-8 pl-8 text-sm"
            />
            {q ? (
              <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="size-3.5" />
              </button>
            ) : (
              <Kbd className="absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>
            )}
          </div>
          <div className="flex gap-1.5">
            {tab === "placed" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <FilterButton active={who !== "all"}>
                    <UserRound className="size-3.5 opacity-60" />
                    {{ all: "Everyone", mine: "Mine", unassigned: "Unassigned", refunds: "Refunds" }[who]}
                  </FilterButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  <DropdownMenuRadioGroup value={who} onValueChange={(v) => setWho(v as Who)}>
                    <DropdownMenuRadioItem value="all">
                      Everyone<span className="ml-auto font-mono text-xs text-muted-foreground">{searched.length}</span>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="mine">
                      Assigned to me<span className="ml-auto font-mono text-xs text-muted-foreground">{mineCount}</span>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="unassigned">
                      Unassigned<span className="ml-auto font-mono text-xs text-muted-foreground">{unassignedCount}</span>
                    </DropdownMenuRadioItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuRadioItem value="refunds">
                      Refund requests
                      <span className={cn("ml-auto font-mono text-xs", refundCount ? "font-medium text-destructive" : "text-muted-foreground")}>{refundCount}</span>
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <FilterButton active={!!reward} className="min-w-0 flex-1">
                  <span className="min-w-0 truncate">{pick ? pick.name : reward ? "Prize" : "All prizes"}</span>
                  <span className="font-mono opacity-60">{pick ? pick.n : picks.length ? picks.length : ""}</span>
                </FilterButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>How many of each to send</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={reward ?? ""} onValueChange={(v) => setReward(v || null)}>
                  <DropdownMenuRadioItem value="">
                    All prizes<span className="ml-auto font-mono text-xs text-muted-foreground">{forWho.length}</span>
                  </DropdownMenuRadioItem>
                  <DropdownMenuSeparator />
                  {picks.map((p) => (
                    <DropdownMenuRadioItem key={p.slug} value={p.slug}>
                      <span className="min-w-0 truncate">{p.name}</span>
                      {p.digital && <Send className="size-3 text-muted-foreground" aria-label="digital" />}
                      <span className="ml-auto font-mono text-xs text-muted-foreground">{p.n}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {filtering && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-7"
                aria-label="Clear filters"
                onClick={() => {
                  setQ("");
                  setReward(null);
                  setWho("all");
                }}
              >
                <X />
              </Button>
            )}
          </div>
        </div>

        {shown.length === 0 ? (
          <div className="flex flex-col items-start gap-2 px-4 py-6 text-muted-foreground">
            {filtering ? (
              <>
                <p>Nothing matches.</p>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    setQ("");
                    setReward(null);
                    setWho("all");
                  }}
                >
                  Clear filters
                </Button>
              </>
            ) : tab === "placed" ? (
              <p className="flex items-center gap-1.5">
                <Check className="size-4 text-emerald-600" />
                Everything&apos;s shipped.
              </p>
            ) : (
              <p>Nothing {tab === "fulfilled" ? "shipped" : "cancelled"} yet.</p>
            )}
          </div>
        ) : (
          <ol className="max-h-[40svh] min-h-0 flex-1 overflow-y-auto lg:max-h-none">
            {shown.map((r) => {
              const active = current?.id === r.id;
              const days = daysSince(r.createdAt, now);
              const together = tab === "placed" ? (openBy.get(r.user.id)?.length ?? 0) : 0;
              const holder = tab === "placed" ? assigneeOf(r) : null;
              return (
                <li key={r.id} id={`order-${r.id}`} className="border-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setSelected(r.id)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "relative flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                      active ? "bg-muted before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-foreground" : "hover:bg-muted/60",
                    )}
                  >
                    <Thumb row={r} className="size-9" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium">{r.reward}</span>
                        <span className="font-mono text-xs text-muted-foreground">#{r.number}</span>
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="min-w-0 flex-1 truncate">{r.user.displayName}</span>
                        {asksRefund(r) && <span className="rounded bg-destructive/10 px-1 font-medium text-destructive">refund?</span>}
                        {holder && (
                          <span
                            title={`Assigned to ${holder.name}`}
                            className={cn("inline-flex max-w-24 items-center gap-0.5 truncate", holder.id === me ? "font-medium text-foreground" : "")}
                          >
                            <UserRound className="size-3 shrink-0" />
                            {holder.id === me ? "you" : holder.name.split(" ")[0]}
                          </span>
                        )}
                        {together > 1 && (
                          <span title={`${together} open orders from them: ship together`} className="inline-flex items-center gap-0.5 font-medium text-amber-700">
                            <Layers className="size-3" />
                            {together}
                          </span>
                        )}
                        {r.digital && <Send className="size-3" aria-label="digital" />}
                        {tab === "placed" ? (
                          <span className={cn("font-mono", ageTone(days))}>{days < 1 ? "today" : `${days}d`}</span>
                        ) : (
                          <span>{r.handledAt ? new Date(r.handledAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "just now"}</span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}

        {oldest !== null && (
          <p className="shrink-0 border-t px-3 py-1.5 text-xs text-muted-foreground">
            Oldest has waited <span className={cn("font-mono font-medium", ageTone(oldest))}>{oldest < 1 ? "under a day" : `${oldest} day${oldest === 1 ? "" : "s"}`}</span>
          </p>
        )}
        <p className="hidden shrink-0 border-t px-3 py-1.5 text-xs leading-relaxed text-muted-foreground lg:block">
          <Kbd>J</Kbd>/<Kbd>K</Kbd> move · <Kbd>A</Kbd> take · <Kbd>R</Kbd> address · <Kbd>⌘↵</Kbd> done
        </p>
      </aside>

      {/* Order */}
      <section className="flex min-h-0 min-w-0 flex-col">
        {flash && <FlashBar flash={flash} onOpen={() => open(flash.id)} onClose={() => setFlash(null)} />}
        {!current ? (
          <div className="flex min-h-48 flex-1 items-center justify-center text-muted-foreground">
            {shown.length || filtering ? "Pick an order." : tab === "placed" ? "Nothing waiting. New orders show up here." : null}
          </div>
        ) : (
          <Detail
            key={current.id}
            row={current}
            state={stateOf(current)}
            now={now}
            others={(openBy.get(current.user.id) ?? []).filter((o) => o.id !== current.id)}
            address={addresses[current.id] ?? null}
            revealError={revealError[current.id] ?? null}
            revealing={revealing === current.id}
            onReveal={() => reveal(current)}
            note={notes[current.id] ?? ""}
            setNote={(v) => setNotes((n) => ({ ...n, [current.id]: v }))}
            copied={copied}
            copy={copy}
            onOpen={open}
            onAct={(action, note) => act(current, action, note)}
            assignee={assigneeOf(current)}
            me={me}
            people={people}
            onAssign={(to) => assign(current, to)}
            asksRefund={asksRefund(current)}
            denial={denialOf(current)}
            onDeny={(message) => deny(current, message)}
          />
        )}
      </section>
    </div>
  );
}

function Detail({
  row,
  state,
  now,
  others,
  address,
  revealError,
  revealing,
  onReveal,
  note,
  setNote,
  copied,
  copy,
  onOpen,
  onAct,
  assignee,
  me,
  people,
  onAssign,
  asksRefund,
  denial,
  onDeny,
}: {
  row: OrderRow;
  state: State;
  now: number;
  others: OrderRow[];
  address: Address | null;
  revealError: string | null;
  revealing: boolean;
  onReveal: () => void;
  note: string;
  setNote: (v: string) => void;
  copied: string | null;
  copy: (key: string, text: string) => void;
  onOpen: (id: string) => void;
  onAct: (action: "fulfil" | "reject", note: string) => void;
  assignee: Person | null;
  me: string;
  people: Person[];
  onAssign: (to: Person | null) => void;
  asksRefund: boolean;
  denial: string | null;
  onDeny: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const days = daysSince(row.createdAt, now);
  const placed = state === "placed";
  const verb = row.digital ? "sent" : "shipped";

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col">
          {/* What */}
          <header className="flex items-start gap-4 border-b px-5 py-4">
            <Thumb row={row} className="size-16" />
            <div className="min-w-0 flex-1">
              <h1 className="text-lg leading-tight font-semibold tracking-tight">{row.reward}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span className="font-mono">#{row.number}</span>
                <span aria-hidden>·</span>
                <span>{row.cost} BITES</span>
                <span aria-hidden>·</span>
                <span>{when(new Date(row.createdAt))}</span>
                {placed && (
                  <>
                    <span aria-hidden>·</span>
                    <span className={cn("font-medium", ageTone(days))}>{days < 1 ? "placed today" : `waiting ${days} day${days === 1 ? "" : "s"}`}</span>
                  </>
                )}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <StateBadge state={state} digital={row.digital} />
              {placed && <AssignMenu assignee={assignee} me={me} people={people} onAssign={onAssign} />}
            </div>
          </header>

          {asksRefund ? (
            <RefundRequest row={row} onApprove={() => onAct("reject", "Refunded, as you asked.")} onDeny={onDeny} />
          ) : (
            row.refundRequestedAt &&
            denial !== null && (
              <Block label="Refund requested, denied">
                {row.refundReason && <p className="leading-relaxed whitespace-pre-wrap text-muted-foreground">They said: {row.refundReason}</p>}
                <p className="mt-1 leading-relaxed whitespace-pre-wrap">
                  <span className="text-xs font-medium text-muted-foreground">Told them: </span>
                  {denial}
                </p>
              </Block>
            )
          )}

          {row.note && (
            <Block label="Their note">
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 leading-relaxed whitespace-pre-wrap text-amber-950">{row.note}</p>
            </Block>
          )}

          {/* Who */}
          <Block label="Recipient">
            <div className="flex items-center gap-3">
              <Avatar className="size-9">
                {row.user.avatarUrl && <AvatarImage src={row.user.avatarUrl} alt="" />}
                <AvatarFallback className="text-xs">{row.user.displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {row.user.displayName}
                  {row.user.slackHandle && <span className="ml-1.5 font-normal text-muted-foreground">@{row.user.slackHandle}</span>}
                </p>
                <CopyText value={row.user.email} id={`email-${row.id}`} copied={copied} copy={copy} className="text-xs text-muted-foreground" />
              </div>
              {row.user.slackId && (
                <a
                  href={`https://hackclub.slack.com/team/${row.user.slackId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium underline-offset-4 hover:underline"
                >
                  Slack
                  <ExternalLink className="size-3 text-muted-foreground" />
                </a>
              )}
            </div>
            {placed && others.length > 0 && (
              <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                <p className="flex items-center gap-1.5 font-medium">
                  <Layers className="size-3.5" />
                  {others.length === 1 ? "One more open order" : `${others.length} more open orders`} from them. Ship together?
                </p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {others.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => onOpen(o.id)}
                        className="rounded border border-amber-300 bg-white px-1.5 py-0.5 font-medium hover:border-amber-500"
                      >
                        {o.reward} <span className="font-mono opacity-60">#{o.number}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Block>

          {/* Where */}
          <Block label={row.digital ? "Send to" : "Ship to"}>
            {row.digital ? (
              <div className="flex flex-col gap-1">
                <p className="text-muted-foreground">Digital prize, nothing to post. Send it to their email:</p>
                <CopyText value={row.user.email} id={`email-${row.id}`} copied={copied} copy={copy} className="font-mono text-sm" />
              </div>
            ) : address ? (
              <div className="flex flex-col gap-2">
                <address className="flex flex-col rounded-md border bg-background py-1.5 font-mono text-sm leading-relaxed not-italic">
                  {addressLines(address).map((line, i) => (
                    <CopyText key={i} value={line} id={`line-${row.id}-${i}`} copied={copied} copy={copy} className="px-3" block />
                  ))}
                  {address.phone && (
                    <CopyText value={address.phone} id={`phone-${row.id}`} copied={copied} copy={copy} className="px-3 text-muted-foreground" block label="tel" />
                  )}
                </address>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => copy(`all-${row.id}`, addressLines(address).join("\n"))}>
                    {copied === `all-${row.id}` ? <Check className="text-emerald-600" /> : <Copy />}
                    {copied === `all-${row.id}` ? "Copied" : "Copy address"}
                    <Kbd>C</Kbd>
                  </Button>
                  {!address.phone && <span className="text-xs text-muted-foreground">No phone number on file.</span>}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-2 rounded-md border border-dashed px-3 py-3">
                <Button variant="outline" size="sm" onClick={onReveal} disabled={revealing}>
                  {revealing ? <Loader2 className="animate-spin" /> : <Eye />}
                  Show address
                  <Kbd>R</Kbd>
                </Button>
                <p className="text-xs text-muted-foreground">Hidden until you need it. Each reveal goes in the audit log under your name.</p>
                {revealError && <p className="text-xs font-medium text-destructive">{revealError}</p>}
              </div>
            )}
          </Block>

          {!placed && (
            <Block label={state === "fulfilled" ? `Marked ${verb}` : "Cancelled and refunded"}>
              <p>
                {row.handler ? <span className="font-medium">{row.handler}</span> : "You"}
                <span className="text-muted-foreground"> · {row.handledAt ? when(new Date(row.handledAt)) : "just now"}</span>
              </p>
              {row.internalNote && (
                <p className="mt-1.5 leading-relaxed whitespace-pre-wrap text-muted-foreground">
                  <span className="text-xs font-medium text-foreground">{state === "rejected" ? "Reason, sent to them: " : "Internal note: "}</span>
                  {row.internalNote}
                </p>
              )}
            </Block>
          )}
        </div>
      </div>

      {/* Do */}
      {placed && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onAct("fulfil", note);
          }}
          className="shrink-0 border-t bg-background/60"
        >
          <div className="mx-auto flex max-w-2xl flex-col gap-2 px-5 py-3">
            <label htmlFor={`note-${row.id}`} className="text-xs font-medium text-muted-foreground">
              Internal note <span className="font-normal">· optional, only admins see it</span>
            </label>
            <Input
              id={`note-${row.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder={row.digital ? "e.g. sent the code by email" : "e.g. tracking number, where you ordered it"}
              className="h-9 bg-card"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={asksRefund}>
                <Check />
                Mark {verb}
                <kbd className="ml-1 font-mono text-[0.7rem] opacity-60">⌘↵</kbd>
              </Button>
              <AlertDialog onOpenChange={(o) => !o && setReason("")}>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive">
                    Cancel &amp; refund…
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Cancel #{row.number}, {row.reward}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {row.user.displayName} gets their {row.cost} BITES back and a Slack DM with your reason. You can&apos;t undo this.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`reason-${row.id}`} className="text-xs font-medium text-muted-foreground">
                      Reason · they&apos;ll see this
                    </label>
                    <Textarea
                      id={`reason-${row.id}`}
                      autoFocus
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={500}
                      placeholder="Sorry, we're out of these. Pick something else in the shop!"
                    />
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep order</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={!reason.trim()}
                      onClick={() => onAct("reject", reason)}
                      className="bg-destructive text-white hover:bg-destructive/90"
                    >
                      Cancel &amp; refund
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <span className="ml-auto text-right text-xs text-muted-foreground">
                {asksRefund && <span className="block font-medium text-destructive">Answer their refund request first.</span>}
                {assignee && assignee.id !== me && (
                  <span className="block font-medium text-amber-700">Assigned to {assignee.name}. Check with them first.</span>
                )}
                They get a Slack DM saying it&apos;s on its way.
              </span>
            </div>
          </div>
        </form>
      )}
    </>
  );
}

// Approving cancels and refunds like any cancellation; denying keeps the order in the queue
// and tells them why. Both DM them.
function RefundRequest({ row, onApprove, onDeny }: { row: OrderRow; onApprove: () => void; onDeny: (message: string) => void }) {
  const [message, setMessage] = useState("");
  return (
    <section className="border-b border-l-2 border-l-destructive bg-destructive/5 px-5 py-4">
      <h2 className="text-sm font-semibold text-destructive">They asked for a refund</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {row.refundRequestedAt && when(new Date(row.refundRequestedAt))} · approving cancels the order and gives back {row.cost} BITES
      </p>
      {row.refundReason ? (
        <p className="mt-2 rounded-md border bg-background px-3 py-2 leading-relaxed whitespace-pre-wrap">{row.refundReason}</p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No reason given.</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={onApprove}>
          <Check />
          Approve refund
        </Button>
        <AlertDialog onOpenChange={(o) => !o && setMessage("")}>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline">
              Deny…
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Deny the refund on #{row.number}?</AlertDialogTitle>
              <AlertDialogDescription>
                The order stays in the queue to ship, and {row.user.displayName} gets a Slack DM with your reason. They can&apos;t ask again.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`deny-${row.id}`} className="text-xs font-medium text-muted-foreground">
                Reason · they&apos;ll see this
              </label>
              <Textarea
                id={`deny-${row.id}`}
                autoFocus
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={500}
                placeholder="It's already packed and on its way to you!"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Back</AlertDialogCancel>
              <AlertDialogAction disabled={!message.trim()} onClick={() => onDeny(message)}>
                Deny refund
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  );
}

// Who's posting this one. Taking an order is one key (A); handing it to someone else is the menu.
function AssignMenu({ assignee, me, people, onAssign }: { assignee: Person | null; me: string; people: Person[]; onAssign: (to: Person | null) => void }) {
  const mine = assignee?.id === me;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="xs" className={cn("max-w-48", !assignee && "border-dashed text-muted-foreground")}>
          {assignee ? <UserRound /> : <UserRoundPlus />}
          <span className="truncate">{assignee ? (mine ? "You" : assignee.name) : "Assign"}</span>
          <ChevronDown className="opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {!mine && (
          <>
            <DropdownMenuItem onSelect={() => onAssign(people.find((p) => p.id === me) ?? null)}>
              <UserRoundPlus />
              Assign to me
              <Kbd className="ml-auto">A</Kbd>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel>Admins</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={assignee?.id ?? ""} onValueChange={(id) => onAssign(people.find((p) => p.id === id) ?? null)}>
          {people.map((p) => (
            <DropdownMenuRadioItem key={p.id} value={p.id}>
              <span className="truncate">{p.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {assignee && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onAssign(null)}>
              <X />
              Unassign
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilterButton({ active, className, children, ...props }: React.ComponentProps<"button"> & { active: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors",
        active ? "border-foreground bg-foreground text-background" : "bg-background hover:border-foreground/40",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDown className="ml-auto size-3 shrink-0 opacity-50" />
    </button>
  );
}

function FlashBar({ flash, onOpen, onClose }: { flash: Flash; onOpen: () => void; onClose: () => void }) {
  return (
    <p
      role={flash.kind === "error" ? "alert" : "status"}
      className={cn(
        "flex shrink-0 items-center gap-2 border-b px-4 py-1.5 text-xs",
        flash.kind === "ok" && "bg-emerald-50 text-emerald-800",
        flash.kind === "pending" && "bg-muted text-muted-foreground",
        flash.kind === "error" && "bg-destructive/10 font-medium text-destructive",
      )}
    >
      {flash.kind === "pending" ? <Loader2 className="size-3.5 animate-spin" /> : flash.kind === "ok" ? <Check className="size-3.5" /> : null}
      <span className="min-w-0 flex-1">{flash.text}</span>
      {flash.kind !== "pending" && (
        <button type="button" onClick={onOpen} className="font-medium underline underline-offset-4">
          {flash.kind === "error" ? "Open it" : "View"}
        </button>
      )}
      <button type="button" onClick={onClose} aria-label="Dismiss" className="opacity-60 hover:opacity-100">
        <X className="size-3.5" />
      </button>
    </p>
  );
}

// Click to copy, for the bits that get pasted into a shipping form one field at a time.
function CopyText({
  value,
  id,
  copied,
  copy,
  className,
  block = false,
  label,
}: {
  value: string;
  id: string;
  copied: string | null;
  copy: (key: string, text: string) => void;
  className?: string;
  block?: boolean;
  label?: string;
}) {
  const done = copied === id;
  return (
    <button
      type="button"
      onClick={() => copy(id, value)}
      title="Copy"
      className={cn(
        "group inline-flex max-w-full items-center gap-1.5 text-left transition-colors hover:text-foreground",
        block && "flex w-full hover:bg-muted",
        className,
      )}
    >
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
      <span className="min-w-0 truncate">{value}</span>
      {done ? (
        <Check className="size-3 shrink-0 text-emerald-600" />
      ) : (
        <Copy className={cn("size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100", block && "ml-auto")} />
      )}
    </button>
  );
}

function StateBadge({ state, digital }: { state: State; digital: boolean }) {
  const [label, tone] =
    state === "placed"
      ? [digital ? "To send" : "To ship", "border-foreground/20 text-foreground"]
      : state === "fulfilled"
        ? [digital ? "Sent" : "Shipped", "border-emerald-300 bg-emerald-50 text-emerald-800"]
        : ["Cancelled", "border-transparent bg-muted text-muted-foreground"];
  return <span className={cn("shrink-0 rounded border px-2 py-0.5 text-xs font-medium", tone)}>{label}</span>;
}

function Thumb({ row, className }: { row: OrderRow; className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-md border bg-background p-1", className)}>
      {row.img ? (
        <Image src={row.img.src} alt="" width={row.img.w} height={row.img.h} className="max-h-full w-auto max-w-full object-contain" />
      ) : (
        <span className="font-mono text-[0.6rem] text-muted-foreground">#{row.number}</span>
      )}
    </span>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="border-b px-5 py-4">
      <h2 className="mb-2 text-xs font-medium text-muted-foreground">{label}</h2>
      {children}
    </section>
  );
}

function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("rounded border bg-muted px-1 font-mono text-[0.7rem] text-foreground", className)}>{children}</kbd>;
}
