"use client";

import "rrweb-player/dist/style.css";

import { useEffect, useRef, useState } from "react";

import { ACTIVE_TAG, duration } from "@/lib/review-time";
import { cn } from "@/lib/utils";

type Event = { type: number; timestamp: number; data?: { tag?: string; payload?: Record<string, unknown> } };
type Mark = { at: number; kind: "ship" | "submit" | "refused"; shipId: string; text: string };
type RRPlayer = {
  goto: (ms: number, play?: boolean) => void;
  addEventListener: (event: string, handler: (params: unknown) => unknown) => void;
  $destroy?: () => void;
};

const CUSTOM = 5;
// Start a jump this far before the moment, for context.
const LEAD_MS = 5_000;

export default function Player({ id, focusShip, ships }: { id: string; focusShip: string | null; ships: { shipId: string | null; label: string; ms: number }[] }) {
  const box = useRef<HTMLDivElement>(null);
  const player = useRef<RRPlayer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [now, setNow] = useState(0);
  const names = new Map(ships.map((s) => [s.shipId, s.label]));

  useEffect(() => {
    let dead = false;
    (async () => {
      const res = await fetch(`/api/replay/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Couldn't load the recording (${res.status}).`);
      const events = ((await res.json()) as Event[]).sort((a, b) => a.timestamp - b.timestamp);
      if (dead) return;
      if (events.length < 2) throw new Error("Not enough was recorded to play back.");
      const { default: RRWebPlayer } = await import("rrweb-player");
      if (dead || !box.current) return;
      const start = events[0].timestamp;
      const found: Mark[] = events.flatMap((e): Mark[] => {
        if (e.type !== CUSTOM || e.data?.tag === ACTIVE_TAG) return [];
        const p = e.data?.payload ?? {};
        const shipId = String(p.shipId ?? "");
        if (e.data?.tag === "ship") return [{ at: e.timestamp - start, kind: "ship", shipId, text: p.reviewing === false ? "Looked at" : "Opened" }];
        if (e.data?.tag === "submit") return [{ at: e.timestamp - start, kind: "submit", shipId, text: p.kind === "reject" ? "Sent back" : "Approved" }];
        if (e.data?.tag === "refused") return [{ at: e.timestamp - start, kind: "refused", shipId, text: p.error === "recording" ? "Blocked, not recording" : `Refused: ${String(p.error)}` }];
        return [];
      });
      // A press that was refused didn't decide anything; say so on the press itself.
      found.forEach((m, i) => {
        const next = found.slice(i + 1).find((n) => n.shipId === m.shipId && n.kind !== "ship");
        if (m.kind === "submit" && next?.kind === "refused") m.text = m.text === "Sent back" ? "Tried to send back" : "Tried to approve";
      });
      setMarks(found);
      const width = box.current.clientWidth;
      const p = new RRWebPlayer({
        target: box.current,
        props: { events: events as never, width, height: Math.round(width * 0.58), autoPlay: false, skipInactive: true, showController: true, mouseTail: false },
      }) as unknown as RRPlayer;
      player.current = p;
      p.addEventListener("ui-update-current-time", (e) => setNow(Number((e as { payload?: number }).payload ?? 0)));
      setLoading(false);
      // Deep link from the audit: jump to the decision on that ship, or else when it was opened.
      if (focusShip) {
        const target = [...found].reverse().find((m) => m.shipId === focusShip && m.kind === "submit") ?? found.find((m) => m.shipId === focusShip);
        if (target) p.goto(Math.max(0, target.at - LEAD_MS), false);
      }
    })().catch((e) => {
      if (!dead) {
        setError(String(e?.message ?? e));
        setLoading(false);
      }
    });
    return () => {
      dead = true;
      player.current?.$destroy?.();
      player.current = null;
    };
  }, [id, focusShip]);

  const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  const currentIdx = marks.reduce((idx, m, i) => (m.at <= now ? i : idx), -1);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="card min-w-0 bg-white p-2">
        {loading && <p className="p-6 text-sm text-black/50">Loading the recording…</p>}
        {error && <p className="p-6 text-sm text-destructive">{error}</p>}
        <div ref={box} className="w-full [&_.rr-player]:!shadow-none" />
      </div>

      <aside className="flex flex-col gap-4">
        <section className="card bg-white">
          <h2 className="border-b px-3 py-2 text-xs font-medium text-black/60">Timeline</h2>
          {marks.length === 0 ? (
            <p className="px-3 py-2 text-sm text-black/50">{loading ? "…" : "No ships opened in this recording."}</p>
          ) : (
            <ol className="max-h-[50svh] overflow-y-auto">
              {marks.map((m, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => player.current?.goto(Math.max(0, m.at - (m.kind === "ship" ? 0 : LEAD_MS)), true)}
                    className={cn(
                      "flex w-full items-baseline gap-2 border-b px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-black/[0.03]",
                      i === currentIdx && "bg-accent/40",
                      m.shipId === focusShip && "font-medium",
                    )}
                  >
                    <span className="font-mono text-xs text-black/50 tabular-nums">{clock(m.at)}</span>
                    <span
                      className={cn(
                        "shrink-0 text-xs",
                        m.kind === "refused" ? "max-w-40 truncate text-amber-700" : m.text.startsWith("Tried") ? "text-black/50" : m.kind === "submit" ? (m.text === "Sent back" ? "text-destructive" : "text-emerald-700") : "text-black/60",
                      )}
                      title={m.text}
                    >
                      {m.text}
                    </span>
                    <span className="min-w-0 truncate">{names.get(m.shipId) ?? "a ship"}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        {ships.length > 0 && (
          <section className="card bg-white">
            <h2 className="border-b px-3 py-2 text-xs font-medium text-black/60">Active time in this recording</h2>
            <ul>
              {ships
                .filter((s) => s.ms >= 1000)
                .sort((a, b) => b.ms - a.ms)
                .map((s) => (
                  <li key={s.shipId ?? "none"} className={cn("flex items-baseline gap-2 border-b px-3 py-1.5 text-sm last:border-b-0", s.shipId === focusShip && "font-medium")}>
                    <span className={cn("min-w-0 flex-1 truncate", !s.shipId && "text-black/50")}>{s.label}</span>
                    <span className="font-mono text-xs tabular-nums">{duration(s.ms)}</span>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}
