import "server-only";

import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { gunzipSync } from "node:zlib";

import { db } from "./db/client";
import { ACTIVE_TAG, type ActivePayload } from "@/lib/review-time";

import { replayChunks, replaySessions, reviewActivity, users, type ReplaySession } from "./db/schema";

export const REPLAY_ID = /^[0-9a-f-]{36}$/;
// Under Vercel's 4.5MB request cap. The client splits well below this.
export const MAX_CHUNK_BYTES = 4_000_000;
// How recently a desk must have uploaded for its reviewer to decide a ship.
const LIVE_MS = 2 * 60_000;

export class ReplayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Upload = {
  userId: string;
  sessionId: string;
  userAgent: string | null;
  // Absent for a bare error report or end marker.
  chunk?: { seq: number; gz: Buffer };
  ended?: boolean;
  error?: string;
};

// Takes one upload from the desk. Chunks are keyed by (session, seq), so a retry of
// one that already landed is a no-op.
export async function saveUpload(u: Upload): Promise<void> {
  let parsed: { events: number; firstTs: number | null; lastTs: number | null } | null = null;
  let active: ActivePayload[] = [];
  if (u.chunk) {
    // Check it's what the recorder sends before storing it, so a replay never dies on a bad chunk.
    let events: unknown;
    try {
      events = JSON.parse(gunzipSync(u.chunk.gz).toString("utf8"));
    } catch {
      throw new ReplayError("chunk isn't gzipped JSON", 400);
    }
    if (!Array.isArray(events)) throw new ReplayError("chunk isn't an event array", 400);
    const ts = events.map((e) => (e as { timestamp?: unknown })?.timestamp).filter((t): t is number => typeof t === "number");
    parsed = { events: events.length, firstTs: ts.length ? Math.min(...ts) : null, lastTs: ts.length ? Math.max(...ts) : null };
    active = events.map(activeOf).filter((a): a is ActivePayload => a !== null);
  }

  await db.transaction(async (tx) => {
    await tx.insert(replaySessions).values({ id: u.sessionId, userId: u.userId, userAgent: u.userAgent }).onConflictDoNothing();
    const [s] = await tx.select({ userId: replaySessions.userId }).from(replaySessions).where(eq(replaySessions.id, u.sessionId)).for("update");
    if (s?.userId !== u.userId) throw new ReplayError("not your session", 403);

    const set: Partial<typeof replaySessions.$inferInsert> = {};
    if (u.chunk && parsed) {
      const [added] = await tx
        .insert(replayChunks)
        .values({ sessionId: u.sessionId, seq: u.chunk.seq, data: u.chunk.gz, ...parsed })
        .onConflictDoNothing()
        .returning({ seq: replayChunks.seq });
      if (added && active.length) {
        await tx.insert(reviewActivity).values(
          active.map((a) => ({
            userId: u.userId,
            sessionId: u.sessionId,
            seq: u.chunk!.seq,
            shipId: a.ship,
            activeMs: a.ms,
            fromAt: new Date(a.from),
            toAt: new Date(a.to),
          })),
        );
      }
      if (added) {
        set.chunks = sql`${replaySessions.chunks} + 1` as unknown as number;
        set.bytes = sql`${replaySessions.bytes} + ${u.chunk.gz.length}` as unknown as number;
      }
    }
    // Any upload, even a retry, proves the desk is still recording and reaching us.
    set.lastChunkAt = new Date();
    if (u.ended) set.endedAt = new Date();
    if (u.error) {
      set.error = u.error.slice(0, 1000);
      set.errorAt = new Date();
    }
    await tx.update(replaySessions).set(set).where(eq(replaySessions.id, u.sessionId));
  });
}

const CUSTOM = 5;
// One stretch of active time out of a chunk, if the event is one and it's sane.
function activeOf(e: unknown): ActivePayload | null {
  const ev = e as { type?: unknown; data?: { tag?: unknown; payload?: Partial<Record<keyof ActivePayload, unknown>> } };
  if (ev?.type !== CUSTOM || ev.data?.tag !== ACTIVE_TAG) return null;
  const p = ev.data.payload ?? {};
  const { ms, from, to } = p;
  if (typeof ms !== "number" || typeof from !== "number" || typeof to !== "number") return null;
  if (!Number.isFinite(ms) || !Number.isFinite(from) || !Number.isFinite(to) || ms <= 0 || to < from) return null;
  const ship = typeof p.ship === "string" && p.ship.length <= 64 ? p.ship : null;
  // Can't be active for longer than the span it covers.
  return { ship, ms: Math.round(Math.min(ms, to - from + 1000, 3_600_000)), from, to };
}

// Whether the reviewer's desk is recording right now. Decisions need one.
export async function replayLive(userId: string, sessionId: string): Promise<boolean> {
  if (!REPLAY_ID.test(sessionId)) return false;
  const [s] = await db
    .select({ userId: replaySessions.userId, lastChunkAt: replaySessions.lastChunkAt, chunks: replaySessions.chunks })
    .from(replaySessions)
    .where(eq(replaySessions.id, sessionId))
    .limit(1);
  return !!s && s.userId === userId && s.chunks > 0 && Date.now() - s.lastChunkAt.getTime() < LIVE_MS;
}

export type ReplayRow = ReplaySession & {
  reviewer: { id: string; displayName: string };
  // Seqs missing between 0 and the highest one we have.
  gaps: number;
  // Stopped uploading without the tab saying goodbye.
  cutOff: boolean;
};

export async function listReplays({ limit = 200, userId, from }: { limit?: number; userId?: string; from?: Date } = {}): Promise<ReplayRow[]> {
  const rows = await db
    .select({
      s: replaySessions,
      reviewer: { id: users.id, displayName: users.displayName },
      maxSeq: sql<number | null>`(select max(${replayChunks.seq}) from ${replayChunks} where ${replayChunks.sessionId} = ${replaySessions.id})`,
    })
    .from(replaySessions)
    .innerJoin(users, eq(replaySessions.userId, users.id))
    .where(and(userId ? eq(replaySessions.userId, userId) : undefined, from ? gte(replaySessions.startedAt, from) : undefined))
    .orderBy(desc(replaySessions.startedAt))
    .limit(limit);
  return rows.map(({ s, reviewer, maxSeq }) => ({
    ...s,
    reviewer,
    gaps: maxSeq == null ? 0 : Number(maxSeq) + 1 - s.chunks,
    cutOff: !s.endedAt && Date.now() - s.lastChunkAt.getTime() > LIVE_MS,
  }));
}

export async function replayById(id: string): Promise<ReplayRow | null> {
  if (!REPLAY_ID.test(id)) return null;
  const [row] = await db
    .select({ s: replaySessions, reviewer: { id: users.id, displayName: users.displayName } })
    .from(replaySessions)
    .innerJoin(users, eq(replaySessions.userId, users.id))
    .where(eq(replaySessions.id, id))
    .limit(1);
  if (!row) return null;
  const seqs = await db.select({ seq: replayChunks.seq }).from(replayChunks).where(eq(replayChunks.sessionId, id));
  const max = seqs.reduce((m, r) => Math.max(m, r.seq), -1);
  return {
    ...row.s,
    reviewer: row.reviewer,
    gaps: max + 1 - seqs.length,
    cutOff: !row.s.endedAt && Date.now() - row.s.lastChunkAt.getTime() > LIVE_MS,
  };
}

// Every event in the session, in order, as one JSON array string.
export async function replayEvents(id: string): Promise<string> {
  const chunks = await db
    .select({ data: replayChunks.data })
    .from(replayChunks)
    .where(eq(replayChunks.sessionId, id))
    .orderBy(asc(replayChunks.seq));
  const parts = chunks.map((c) => gunzipSync(c.data).toString("utf8").slice(1, -1)).filter((p) => p.trim());
  return `[${parts.join(",")}]`;
}
