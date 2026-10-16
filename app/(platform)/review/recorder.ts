// Records the review desk with rrweb and ships it to /api/replay (see lib/server/replay.ts).
//
// Events are cut into numbered, gzipped chunks every few seconds. Each chunk is kept in
// IndexedDB until the server has it, so a failed upload is retried, and a crashed or
// closed tab sends what it had on the next visit. Everything that goes wrong lands in
// the status the desk shows, and decisions wait on flush() so none go unrecorded.
//
// It also measures active time: a gap between two interactions (mouse, keys, scroll,
// touch, typing) counts only if it's under IDLE_MS, and goes to the ship open for
// review. Switching tabs counts the same way, so a quick look at the repo on GitHub
// is still review time, but a longer trip away isn't. Those totals ride along in the recording as "active" events, so they get the
// same retries and survive the same crashes; the server pulls them out on upload.
//
// The preview frame records itself and pings its own activity up (see frame-recorder.ts).
import { gzipSync, strToU8 } from "fflate";

import { ACTIVE_TAG, IDLE_MS, type ActivePayload } from "@/lib/review-time";

import { FRAME_ACTIVITY, FRAME_KEY, FRAME_SNAPSHOT } from "./frame-recorder";

export type ReplayState = "off" | "starting" | "ok" | "retrying" | "failed";
export type ReplayStatus = { state: ReplayState; id: string | null; error: string | null; pending: number };

type Chunk = { key: string; session: string; seq: number; gz: Uint8Array; at: number };
type Event = { type: number; timestamp: number };

const FLUSH_MS = 5_000;
const MAX_EVENTS = 2_000;
// Under the server's 4MB cap, with room to spare.
const MAX_GZ = 3_000_000;
// fetch keepalive refuses bodies over 64KB.
const KEEPALIVE_MAX = 60_000;
// An unsent chunk this old means recording is broken, not just slow.
const FAIL_AFTER_MS = 30_000;
const FULL_SNAPSHOT = 2;
const ACTIVITY = ["pointermove", "pointerdown", "keydown", "wheel", "scroll", "input", "touchstart"] as const;

let status: ReplayStatus = { state: "off", id: null, error: null, pending: 0 };
const listeners = new Set<() => void>();

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const getStatus = () => status;
const OFF = status;
export const getServerStatus = () => OFF;

function set(next: Partial<ReplayStatus>) {
  status = { ...status, ...next };
  listeners.forEach((fn) => fn());
}

// ---- IndexedDB, best effort: without it chunks just live in memory.

let idb: Promise<IDBDatabase | null> | null = null;
function store(mode: IDBTransactionMode): Promise<IDBObjectStore | null> {
  idb ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open("shrink-replay", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("chunks", { keyPath: "key" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return idb.then((db) => db?.transaction("chunks", mode).objectStore("chunks") ?? null).catch(() => null);
}
const wrap = <T>(req: IDBRequest<T> | undefined) =>
  new Promise<T | null>((resolve) => {
    if (!req) return resolve(null);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
const keep = async (c: Chunk) => wrap((await store("readwrite"))?.put(c));
const drop = async (key: string) => wrap((await store("readwrite"))?.delete(key));
const leftovers = async () => ((await wrap((await store("readonly"))?.getAll())) ?? []) as Chunk[];

// ---- The recorder.

class Session {
  readonly id = crypto.randomUUID();
  private seq = 0;
  private buffer: Event[] = [];
  private queue: Chunk[] = [];
  private pumping = false;
  private failures = 0;
  private lastFailure: string | null = null;
  private fatal: string | null = null;
  // Reported to the server on the next upload that gets through.
  private report: string | null = null;
  private stopRecord: (() => void) | null = null;
  private rr: typeof import("@rrweb/record").record | null = null;
  // rrweb refuses custom events until its first full snapshot is done, so marks wait here till then.
  private live = false;
  private marks: [string, unknown][] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private waiters: (() => void)[] = [];
  // Active time: the last interaction (null before the first and after leaving), the ship being
  // reviewed, and time credited but not yet written into the recording.
  private lastAct: number | null = null;
  private ship: string | null = null;
  private credits = new Map<string, ActivePayload>();
  private readonly onActivity = () => this.touch(Date.now());
  private readonly onFrameMessage = (e: MessageEvent) => {
    if (e.data?.type === FRAME_ACTIVITY && e.data.key === FRAME_KEY) this.touch(Date.now());
  };
  // Settles once the recorder is running (or has failed to start).
  started: Promise<void> = Promise.resolve();

  async start() {
    set({ state: "starting", id: this.id, error: null, pending: 0 });
    // Anything an earlier tab didn't get to send goes first.
    for (const c of await leftovers()) if (c.session !== this.id) this.queue.push(c);
    this.queue.sort((a, b) => a.at - b.at);
    if (this.queue.length) this.pump();

    try {
      const { record } = await import("@rrweb/record");
      if (this.stopped) return;
      const stop = record<Event>({
        emit: (e) => {
          this.buffer.push(e);
          // Full snapshots are the big ones; send each on its own so chunks stay small.
          if (e.type === FULL_SNAPSHOT || this.buffer.length >= MAX_EVENTS) this.cut();
          // A full snapshot of the desk leaves the frames empty until they send their own.
          if (e.type === FULL_SNAPSHOT) setTimeout(askFramesForSnapshot, 0);
          // rrweb marks itself recording right after this snapshot, in the same task.
          if (e.type === FULL_SNAPSHOT && !this.live) queueMicrotask(() => this.goLive());
        },
        // The preview frame's own recorder posts its events here.
        recordCrossOriginIframes: true,
        // The default waits for window load, which the preview frame can hold up for ages.
        recordAfter: "DOMContentLoaded",
        // A fresh full snapshot every few minutes, so a lost chunk only spoils a few minutes.
        checkoutEveryNms: 3 * 60_000,
        slimDOMOptions: "all",
        sampling: { mousemove: 50, scroll: 150, input: "last" },
        errorHandler: (err) => {
          this.note(`recorder: ${String((err as Error)?.message ?? err)}`);
          return true;
        },
      });
      if (!stop) throw new Error("rrweb didn't start");
      this.stopRecord = stop;
      this.rr = record;
      for (const t of ACTIVITY) window.addEventListener(t, this.onActivity, { capture: true, passive: true });
      window.addEventListener("message", this.onFrameMessage);
      this.lastAct = document.visibilityState === "visible" ? Date.now() : null;
      // The desk may have said which ship is open before we were running.
      this.ship = reviewing;
      if (lastShip) this.addMark("ship", lastShip);
    } catch (e) {
      this.fatal = `Recorder didn't start: ${String((e as Error)?.message ?? e)}`;
      this.report = this.fatal;
      this.update();
      // Still tell the server, so the gap shows up there too.
      this.send(null, false).catch(() => {});
      return;
    }
    this.timer = setInterval(() => {
      this.cut();
      this.update();
    }, FLUSH_MS);
    this.update();
  }

  private goLive() {
    if (this.stopped) return;
    this.live = true;
    for (const [tag, payload] of this.marks.splice(0)) this.addMark(tag, payload);
  }

  addMark(tag: string, payload: unknown) {
    if (!this.stopRecord) return;
    if (!this.live) {
      this.marks.push([tag, payload]);
      return;
    }
    try {
      this.rr?.addCustomEvent(tag, payload);
    } catch (e) {
      this.note(`couldn't add ${tag} marker: ${String((e as Error)?.message ?? e)}`);
    }
  }

  // An interaction at t: the gap since the last one counts if it was short enough.
  touch(t: number) {
    if (this.lastAct !== null) {
      const gap = t - this.lastAct;
      if (gap > 0 && gap <= IDLE_MS) this.credit(this.lastAct, t);
    }
    this.lastAct = t;
  }

  // Leaving: count up to now if they were active, then nothing more.
  pause() {
    this.touch(Date.now());
    this.lastAct = null;
  }

  // A different ship (or none) is open. Time up to now goes to the old one.
  setShip(ship: string | null) {
    if (ship === this.ship) return;
    if (this.lastAct !== null && Date.now() - this.lastAct <= IDLE_MS) this.touch(Date.now());
    this.ship = ship;
  }

  private credit(from: number, to: number) {
    const key = this.ship ?? "";
    const c = this.credits.get(key);
    if (c) {
      c.ms += to - from;
      c.to = to;
    } else {
      this.credits.set(key, { ship: this.ship, ms: to - from, from, to });
    }
  }

  // Write credited time into the recording, so it's uploaded with everything else.
  private writeCredits() {
    // Until rrweb is live, credits keep adding up here instead.
    if (!this.credits.size || !this.rr || !this.stopRecord || !this.live) return;
    const out = [...this.credits.values()];
    this.credits.clear();
    for (const c of out) this.addMark(ACTIVE_TAG, c);
  }

  // Seal the buffer into chunks and queue them.
  cut() {
    this.writeCredits();
    if (!this.buffer.length) return;
    const events = this.buffer;
    this.buffer = [];
    for (const gz of this.pack(events)) {
      const c: Chunk = { key: `${this.id}:${this.seq}`, session: this.id, seq: this.seq++, gz, at: Date.now() };
      this.queue.push(c);
      void keep(c);
    }
    this.pump();
  }

  private pack(events: Event[]): Uint8Array[] {
    let gz: Uint8Array;
    try {
      gz = gzipSync(strToU8(JSON.stringify(events)));
    } catch (e) {
      this.note(`couldn't pack ${events.length} events: ${String((e as Error)?.message ?? e)}`);
      return [];
    }
    if (gz.length <= MAX_GZ) return [gz];
    if (events.length === 1) {
      this.note(`dropped one ${gz.length}-byte event (type ${events[0].type}), too big to upload`);
      return [];
    }
    const mid = events.length >> 1;
    return [...this.pack(events.slice(0, mid)), ...this.pack(events.slice(mid))];
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length && !this.fatal) {
        const c = this.queue[0];
        const r = await this.send(c, false).catch((e) => ({ ok: false, status: 0, error: String(e?.message ?? e) }));
        if (r.ok) {
          this.queue.shift();
          void drop(c.key);
          if (this.failures) this.note(`uploads failed ${this.failures} times in a row before getting through`);
          this.failures = 0;
        } else if (r.status === 401) {
          this.fatal = "Signed out, so recording stopped. Sign back in.";
        } else if (r.status === 400 || r.status === 403 || r.status === 413) {
          // The server will never take this one. Drop it and say so, rather than block the rest.
          this.queue.shift();
          void drop(c.key);
          this.note(`server refused chunk ${c.seq} (${r.status}${r.error ? `: ${r.error}` : ""})`);
        } else {
          this.failures++;
          this.lastFailure = `${r.status ? `server said ${r.status}` : "network error"}${r.error ? `: ${r.error}` : ""}`;
          await new Promise((ok) => setTimeout(ok, Math.min(30_000, 1000 * 2 ** (this.failures - 1))));
        }
        this.update();
      }
    } finally {
      this.pumping = false;
      this.update();
      if (!this.queue.length) this.waiters.splice(0).forEach((fn) => fn());
    }
  }

  private async send(c: Chunk | null, end: boolean, keepalive = false): Promise<{ ok: boolean; status: number; error?: string }> {
    const headers: Record<string, string> = { "content-type": "application/octet-stream", "x-replay-session": c?.session ?? this.id };
    if (c) headers["x-replay-seq"] = String(c.seq);
    if (end) headers["x-replay-end"] = "1";
    const report = c?.session === this.id || !c ? this.report : null;
    if (report) headers["x-replay-error"] = encodeURIComponent(report.slice(0, 1000));
    const body = c?.gz ?? new Uint8Array();
    const res = await fetch("/api/replay", {
      method: "POST",
      headers,
      body: body as BodyInit,
      keepalive,
      cache: "no-store",
      // A hung request would stall the queue; give up and retry instead.
      signal: keepalive ? undefined : AbortSignal.timeout(20_000),
    });
    if (res.ok && report === this.report) this.report = null;
    const error = res.ok ? undefined : await res.json().then((j) => j?.error as string | undefined).catch(() => undefined);
    return { ok: res.ok, status: res.status, error };
  }

  // Cut what's buffered and wait for every chunk to land. True when it all did.
  async flush(timeoutMs: number): Promise<boolean> {
    // Right after a page load rrweb may still be loading; that's not a failure.
    await Promise.race([this.started.catch(() => {}), new Promise((ok) => setTimeout(ok, timeoutMs))]);
    if (this.fatal || !this.stopRecord) return false;
    this.cut();
    if (this.queue.length) {
      await new Promise<void>((ok) => {
        const t = setTimeout(ok, timeoutMs);
        this.waiters.push(() => (clearTimeout(t), ok()));
        this.pump();
      });
    }
    if (this.queue.length || this.fatal) return false;
    // Nothing was waiting, so nothing proved the server is reachable just now. Ask it.
    const r = await this.send(null, false).catch(() => null);
    return !!r?.ok;
  }

  // The tab is hiding or going away: send what's left now, while we still can.
  // keepalive requests outlive the page but only up to 64KB, so the tail goes that
  // way if it fits; anything else waits in IndexedDB for the next visit.
  goodbye(end: boolean) {
    this.cut();
    if (!end) return;
    // The newest chunks are the ones least likely to have made it into IndexedDB yet.
    const tail: Chunk[] = [];
    let budget = KEEPALIVE_MAX;
    for (const c of [...this.queue].reverse()) {
      if (c.session !== this.id) continue;
      if (c.gz.length > budget) break;
      budget -= c.gz.length;
      tail.unshift(c);
    }
    tail.forEach((c, i) => this.send(c, i === tail.length - 1, true).catch(() => {}));
    if (!tail.length) this.send(null, true, true).catch(() => {});
  }

  stop() {
    this.pause();
    this.writeCredits();
    for (const t of ACTIVITY) window.removeEventListener(t, this.onActivity, { capture: true });
    window.removeEventListener("message", this.onFrameMessage);
    this.stopped = true;
    this.stopRecord?.();
    this.stopRecord = null;
    if (this.timer) clearInterval(this.timer);
    this.goodbye(true);
    set({ state: "off", id: null, error: null, pending: 0 });
  }

  private note(msg: string) {
    console.warn("[replay]", msg);
    this.report = msg;
  }

  private update() {
    if (this.stopped) return;
    const oldest = this.queue.find((c) => c.session === this.id)?.at;
    const stale = oldest !== undefined && Date.now() - oldest > FAIL_AFTER_MS;
    const state: ReplayState = this.fatal ? "failed" : !this.stopRecord ? "starting" : stale ? "failed" : this.failures ? "retrying" : "ok";
    const why = this.lastFailure ? ` (${this.lastFailure})` : "";
    const error =
      this.fatal ??
      (state === "failed" ? `Nothing has reached the server for ${Math.round((Date.now() - oldest!) / 1000)}s${why}.` : state === "retrying" ? `Upload failed${why}, retrying.` : null);
    set({ state, error, pending: this.queue.length });
  }
}

function askFramesForSnapshot() {
  for (const f of document.querySelectorAll("iframe")) f.contentWindow?.postMessage({ type: FRAME_SNAPSHOT }, "*");
}

let current: Session | null = null;
// Remembered for a session that hasn't started yet (child effects run before the layout's).
let reviewing: string | null = null;
let lastShip: unknown = null;
let stopping: ReturnType<typeof setTimeout> | null = null;

// Hiding the tab counts as an interaction, and so does coming back: time away is
// credited if they're back within IDLE_MS, like any other pause.
function onHide() {
  current?.touch(Date.now());
  if (document.visibilityState === "hidden") current?.goodbye(false);
}
function onPageHide() {
  current?.pause();
  current?.goodbye(true);
}

// Starts recording, once per tab. The returned stop is deferred a tick so a
// remount (React dev mode) keeps the same session.
export function startRecording(): () => void {
  if (stopping) clearTimeout(stopping);
  stopping = null;
  if (!current) {
    current = new Session();
    current.started = current.start();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
  }
  return () => {
    stopping = setTimeout(() => {
      current?.stop();
      current = null;
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    }, 0);
  };
}

export async function flushRecording(timeoutMs = 10_000): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!current) return { ok: false, error: "The desk isn't recording. Reload the page." };
  const ok = await current.flush(timeoutMs);
  return ok ? { ok: true, id: current.id } : { ok: false, error: status.error ?? "Recording couldn't reach the server." };
}

export function markRecording(tag: string, payload: unknown) {
  if (tag === "ship") lastShip = payload;
  current?.addMark(tag, payload);
}

// The ship whose review is open, which active time is credited to. Null for none.
export function setReviewing(shipId: string | null) {
  reviewing = shipId;
  current?.setShip(shipId);
}
