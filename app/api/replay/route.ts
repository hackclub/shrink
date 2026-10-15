import type { NextRequest } from "next/server";

import { hasRole } from "@/lib/server/auth/current";
import { currentUser } from "@/lib/server/auth/session";
import { MAX_CHUNK_BYTES, REPLAY_ID, ReplayError, saveUpload } from "@/lib/server/replay";

// Uploads from the review desk's recorder (app/(platform)/review/Recorder.tsx).
// Body is a gzipped JSON array of rrweb events; the rest rides in headers:
//   x-replay-session  the tab's session id
//   x-replay-seq      chunk number, from 0 (absent when there's no body)
//   x-replay-end      "1" when the tab is going away
//   x-replay-error    what's going wrong on the client, URI-encoded
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user || !hasRole(user, "reviewer")) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const h = req.headers;
  const sessionId = h.get("x-replay-session") ?? "";
  if (!REPLAY_ID.test(sessionId)) return Response.json({ ok: false, error: "bad session" }, { status: 400 });

  const body = Buffer.from(await req.arrayBuffer());
  if (body.length > MAX_CHUNK_BYTES) return Response.json({ ok: false, error: "too big" }, { status: 413 });
  let chunk: { seq: number; gz: Buffer } | undefined;
  if (body.length) {
    const seq = Number(h.get("x-replay-seq"));
    if (!Number.isInteger(seq) || seq < 0) return Response.json({ ok: false, error: "bad seq" }, { status: 400 });
    chunk = { seq, gz: body };
  }
  let error: string | undefined;
  try {
    error = h.get("x-replay-error") ? decodeURIComponent(h.get("x-replay-error")!) : undefined;
  } catch {
    error = h.get("x-replay-error") ?? undefined;
  }

  try {
    await saveUpload({ userId: user.id, sessionId, userAgent: h.get("user-agent"), chunk, ended: h.get("x-replay-end") === "1", error });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof ReplayError) return Response.json({ ok: false, error: e.message }, { status: e.status });
    console.error("[replay] upload failed", sessionId, e);
    return Response.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
