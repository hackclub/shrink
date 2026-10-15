import { hasRole } from "@/lib/server/auth/current";
import { currentUser } from "@/lib/server/auth/session";
import { REPLAY_ID, replayEvents } from "@/lib/server/replay";

// A whole desk recording as one JSON array of rrweb events, for the admin player.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user || !hasRole(user, "admin")) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!REPLAY_ID.test(id)) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  return new Response(await replayEvents(id), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
}
