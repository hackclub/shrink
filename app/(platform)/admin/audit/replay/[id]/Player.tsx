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
const INCREMENTAL = 3;
const CANVAS_MUTATION = 9;
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
        props: {
          events: events as never,
          width,
          height: Math.round(width * 0.58),
          autoPlay: false,
          skipInactive: true,
          showController: true,
          mouseTail: false,
          plugins: [canvasFrames()] as never,
        },
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

type Replayer = { getMirror: () => { getNode: (id: number) => Node | null } };
type Frame = { b64: string; type: string };

// Canvas frames from the desk's preview (see review/frame-recorder.ts). rrweb only replays
// these with UNSAFE_replayCanvas, which would let a recorded app's scripts run on this page,
// so draw the images onto the replayed canvas ourselves. Each frame is a whole picture, so
// when seeking only the latest per canvas matters.
function canvasFrames() {
  const pending = new Map<number, Frame>();
  const drawn = new Map<number, number>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    handler(e: { type: number; data?: { source?: number; id?: number; commands?: { property: string; args?: unknown[] }[] } }, _sync: boolean, { replayer }: { replayer: Replayer }) {
      if (e.type !== INCREMENTAL || e.data?.source !== CANVAS_MUTATION || e.data.id === undefined) return;
      const bitmap = e.data.commands?.find((c) => c.property === "drawImage")?.args?.[0] as { rr_type?: string; args?: { type?: string; data?: { base64?: string }[] }[] } | undefined;
      const blob = bitmap?.rr_type === "ImageBitmap" ? bitmap.args?.[0] : undefined;
      const b64 = blob?.data?.[0]?.base64;
      if (!b64) return;
      pending.set(e.data.id, { b64, type: blob?.type ?? "image/webp" });
      timer ??= setTimeout(() => {
        timer = null;
        for (const [id, f] of pending) {
          const n = (drawn.get(id) ?? 0) + 1;
          drawn.set(id, n);
          void draw(replayer, id, f, () => drawn.get(id) === n);
        }
        pending.clear();
      }, 0);
    },
  };
}

async function draw(replayer: Replayer, id: number, f: Frame, current: () => boolean) {
  const node = replayer.getMirror().getNode(id) as HTMLCanvasElement | null;
  if (node?.nodeName !== "CANVAS") return;
  try {
    const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: f.type }));
    // A later frame got there first.
    if (!current()) return bmp.close();
    const ctx = node.getContext("2d");
    ctx?.clearRect(0, 0, node.width, node.height);
    ctx?.drawImage(bmp, 0, 0);
    bmp.close();
  } catch {
    // A bad frame just isn't shown.
  }
}
