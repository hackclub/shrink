import { H1, PixelLink } from "@/app/components/ui/bits";
import { shippingClosed } from "@/lib/program";
import { requireUser } from "@/lib/server/auth/current";
import { fetchProjects } from "@/lib/server/hackatime";
import { canResubmit, projectsInUse, shipById, wasResubmitted } from "@/lib/server/ships";

import ShipForm from "./ShipForm";

export default async function ShipPage({ searchParams }: { searchParams: Promise<{ from?: string; project?: string }> }) {
  const user = await requireUser("/app/ship");
  const { from, project } = await searchParams;

  const [projects, used, previous] = await Promise.all([
    fetchProjects(user.id).catch(() => null),
    projectsInUse(user.id),
    from ? shipById(from) : Promise.resolve(null),
  ]);
  const reship = previous && previous.userId === user.id && canResubmit(previous, await wasResubmitted(previous.id)) ? previous : null;

  const admin = user.role === "admin";
  if (!reship && shippingClosed() && !admin) {
    return (
      <>
        <H1 sub="new ships aren't being taken anymore. if a reviewer sent one of yours back, you can still fix it and resubmit it from your dashboard.">
          shipping is closed
        </H1>
        <PixelLink href="/app">your ships →</PixelLink>
      </>
    );
  }

  return (
    <>
      <H1>{reship ? `resubmit ${reship.title}` : "ship a project"}</H1>
      {admin && (
        <p className="mb-5 font-medium text-black/60">
          you&apos;re an admin, so the hours minimum, blocking scans and the deadline are skipped. your ships stay out of the channel and
          Airtable, but DMs still go to you.
        </p>
      )}
      <ShipForm
        bypass={admin}
        hackatime={projects === null ? null : projects.map((p) => ({ ...p, used: used.has(p.name) }))}
        preselect={project && !used.has(project) ? project : null}
        initial={
          reship
            ? {
                id: reship.id,
                title: reship.title,
                description: reship.description,
                dataUri: reship.dataUri,
                sourceUrl: reship.sourceUrl ?? "",
                hackatimeProjects: reship.hackatimeProjects,
                claimedBadges: reship.claimedBadges,
                reviewerNote: reship.publicMessage,
              }
            : null
        }
      />
    </>
  );
}
