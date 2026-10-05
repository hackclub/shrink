import { notFound } from "next/navigation";

import { AppFrame, ByteMeter, H1, Hours, PixelLink, StatePill, when } from "@/app/components/ui/bits";
import { BADGE_BY_SLUG, capFor } from "@/lib/program";
import { hasRole, requireUser } from "@/lib/server/auth/current";
import { shipById } from "@/lib/server/ships";

import CopyUri from "./CopyUri";
import Shipped from "./Shipped";
import Unship from "./Unship";

export default async function ShipPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ shipped?: string }>;
}) {
  const { id } = await params;
  const user = await requireUser(`/app/ships/${id}`);
  const ship = await shipById(id);
  const mine = ship?.userId === user.id;
  // Non-approved ships are author/reviewer only; others never see the review message or Hackatime details.
  const insider = mine || hasRole(user, "reviewer");
  if (!ship || (!insider && ship.state !== "approved")) notFound();
  const { shipped } = await searchParams;

  return (
    <>
      {shipped && mine && <Shipped reshipOf={ship.reshipOf} />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <H1 sub={<span className="font-mono text-[0.9em]">#{ship.number} · {ship.bytes} bytes · shipped {when(ship.createdAt)}</span>}>
          {ship.title}
        </H1>
        <StatePill state={ship.state} />
      </div>

      <div className="grid grid-cols-1 gap-[clamp(1.25rem,2.5vw,40px)] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-4">
          <div className="card overflow-hidden">
            <div className="aspect-[4/3] bg-ink">
              <AppFrame uri={ship.dataUri} title={ship.title} />
            </div>
          </div>
          <ByteMeter bytes={ship.bytes} />
          <CopyUri uri={ship.dataUri} />
        </div>

        <div className="flex flex-col gap-5">
          {ship.state === "pending" && mine && (
            <Unship
              id={ship.id}
              reshipOf={ship.reshipOf}
              title={ship.title}
              description={ship.description}
              dataUri={ship.dataUri}
              sourceUrl={ship.sourceUrl ?? ""}
              hackatimeProjects={ship.hackatimeProjects}
              claimedBadges={ship.claimedBadges}
            />
          )}
          {ship.state !== "pending" && (
            <div className={`card px-5 py-4 ${ship.state === "approved" ? "border-black bg-white" : "bg-ink text-white"}`}>
              <p className="label" style={ship.state === "rejected" ? { color: "rgba(255,255,255,0.6)" } : undefined}>
                {ship.state === "approved" ? "approved" : "sent back"} · {ship.reviewedAt ? when(ship.reviewedAt) : ""}
              </p>
              {ship.state === "approved" && (
                <p className="font-pixel text-[1.6rem] leading-none">
                  +{ship.awardedBites} BITES
                  <span className="ml-3 font-mono text-[0.7rem] text-black/50">
                    <Hours seconds={ship.awardedSeconds ?? 0} /> · cap {capFor(ship.awardedBadges ?? [])}
                  </span>
                </p>
              )}
              {ship.awardedBadges && ship.awardedBadges.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {ship.awardedBadges.map((b) => (
                    <li key={b} className="rounded-[3px] bg-accent px-[0.45em] py-[0.2em] font-mono text-xs text-black">
                      {BADGE_BY_SLUG.get(b)?.title ?? b} +{BADGE_BY_SLUG.get(b)?.bites}
                    </li>
                  ))}
                </ul>
              )}
              {insider && ship.publicMessage && <p className="mt-3 whitespace-pre-wrap font-medium leading-relaxed">{ship.publicMessage}</p>}
              {ship.state === "rejected" && mine && (
                <div className="mt-4">
                  <PixelLink href={`/app/ship?from=${ship.id}`} variant="light">
                    fix &amp; ship again →
                  </PixelLink>
                </div>
              )}
            </div>
          )}

          <div>
            <p className="label">about</p>
            <p className="whitespace-pre-wrap font-medium leading-relaxed text-black/85">{ship.description}</p>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 border-t-4 border-rule pt-4 text-[0.95rem] font-medium">
            {insider && (
              <>
                <dt className="text-black/50">hackatime</dt>
                <dd>
                  <span className="font-mono text-[0.9em]">{ship.hackatimeProjects.join(", ")}</span> · <Hours seconds={ship.claimedSeconds} />
                </dd>
                <dt className="text-black/50">badges claimed</dt>
                <dd>{ship.claimedBadges.length ? ship.claimedBadges.map((b) => BADGE_BY_SLUG.get(b)?.title ?? b).join(", ") : "none"}</dd>
              </>
            )}
            {ship.sourceUrl && (
              <>
                <dt className="text-black/50">source</dt>
                <dd>
                  <a href={ship.sourceUrl} target="_blank" rel="noreferrer" className="font-mono text-[0.9em] underline underline-offset-4 break-all">
                    {ship.sourceUrl}
                  </a>
                </dd>
              </>
            )}
          </dl>
        </div>
      </div>
    </>
  );
}
