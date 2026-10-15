import Link from "next/link";
import { notFound } from "next/navigation";

import { H1, when } from "@/app/components/ui/bits";
import { duration } from "@/lib/review-time";
import { sessionShips } from "@/lib/server/audit";
import { requireRole } from "@/lib/server/auth/current";
import { replayById } from "@/lib/server/replay";

import { live, span, trouble } from "../../health";
import { AdminNav } from "../../ui";
import Player from "./Player";

export default async function ReplayPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ship?: string }> }) {
  const { id } = await params;
  await requireRole("admin", `/admin/audit/replay/${id}`);
  const r = await replayById(id);
  if (!r) notFound();
  const { ship } = await searchParams;
  const ships = await sessionShips(id);
  const activeMs = ships.reduce((t, s) => t + s.ms, 0);
  const t = trouble(r);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <H1
          sub={
            <>
              <Link href={`/admin/audit/reviewer/${r.reviewer.id}`} className="underline-offset-2 hover:underline">
                ← {r.reviewer.displayName}
              </Link>
              {` · ${when(r.startedAt)} · ${span(r)} long, ${duration(activeMs)} active · ${(r.bytes / 1e6).toFixed(1)} MB${live(r) ? " · still recording" : ""}`}
            </>
          }
        >
          desk recording
        </H1>
        <AdminNav />
      </div>
      {t.length > 0 && (
        <p role="alert" className="mb-4 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          ⚠ {t.join(" · ")}
        </p>
      )}
      {r.error && (
        <p className="mb-4 rounded border border-amber-600/30 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          The desk reported: {r.error}
          {r.errorAt && <span className="ml-1 opacity-70">({when(r.errorAt)})</span>}
        </p>
      )}
      <Player
        id={r.id}
        focusShip={ship ?? null}
        ships={ships.map((s) => ({ shipId: s.shipId, label: s.number == null ? "Not on a ship" : `#${s.number} ${s.title}`, ms: s.ms }))}
      />
    </>
  );
}
