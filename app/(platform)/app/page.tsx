import Link from "next/link";

import { AppFrame, ByteMeter, H1, Hours, PixelLink, StatePill, when } from "@/app/components/ui/bits";
import { PROGRAM_END, PROGRAM_START, instant } from "@/lib/program";
import { requireUser } from "@/lib/server/auth/current";
import { HCA_ADDRESSES_URL, HCA_VERIFY_URL } from "@/lib/server/auth/hca";
import { fetchProjects } from "@/lib/server/hackatime";
import { addressesFor } from "@/lib/server/orders";
import { requestOrigin } from "@/lib/server/origin";
import { referralsOf } from "@/lib/server/referrals";
import { canResubmit, shipsOf } from "@/lib/server/ships";
import { EXAMPLES } from "@/lib/examples";

import ProjectCard from "@/app/components/ProjectCard";

import CopyLink from "./invite/CopyLink";
import GetLink from "./invite/GetLink";
import { BITE_LABEL } from "./invite/rules";

// "3 days left", or hours on the last day; null once it's over.
function timeLeft(date: string): string | null {
  const ms = instant(date).getTime() - Date.now();
  if (ms <= 0) return null;
  const hours = Math.ceil(ms / 3_600_000);
  const n = hours <= 24 ? hours : Math.ceil(ms / 86_400_000);
  const unit = hours <= 24 ? "hour" : "day";
  return `${n} ${unit}${n === 1 ? "" : "s"} left`;
}

function hasStarted(): boolean {
  return Date.now() >= new Date(PROGRAM_START + "T00:00:00").getTime();
}

const startLabel = new Date(PROGRAM_START + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

type Step = { label: string; done: boolean | null; hint: string; href: string | null; action: string };

export default async function Home() {
  const user = await requireUser("/app");
  const [ships, projects, addresses, referrals, origin] = await Promise.all([
    shipsOf(user.id),
    fetchProjects(user.id).catch(() => null),
    addressesFor(user).catch(() => "reconnect" as const),
    user.referralCode ? referralsOf(user) : null,
    requestOrigin(),
  ]);

  const resubmitted = new Set(ships.map((s) => s.reshipOf));
  // A sent-back ship that was resubmitted is replaced by its resubmission.
  const shown = ships.filter((s) => !resubmitted.has(s.id));
  const returned = ships.filter((s) => canResubmit(s, resubmitted.has(s.id)));
  const started = hasStarted();
  const left = timeLeft(PROGRAM_END);
  const tracked = (projects ?? []).reduce((s, p) => s + p.seconds, 0);
  const hasAddress = addresses === "reconnect" ? null : addresses.length > 0;
  const needsVerify = user.eligibility === "blocked_unverified" || user.eligibility === "undetermined";

  const steps: Step[] = [
    {
      label: projects === null ? "link Hackatime" : "track time on Hackatime",
      done: projects !== null && tracked > 0,
      hint:
        projects === null
          ? "we can't read your Hackatime. link it again so your hours count."
          : `nothing logged since ${startLabel}. install the editor plugin and it counts on its own.`,
      href: projects === null ? "/api/auth/hackatime/start?next=/app" : "https://hackatime.hackclub.com",
      action: projects === null ? "link" : "open Hackatime",
    },
    {
      label: "verify your identity with Hack Club",
      done: user.eligibility === "eligible",
      hint:
        user.verificationStatus === "pending"
          ? "submitted. Hack Club is reviewing it."
          : user.eligibility === "blocked_over_18"
            ? "Hack Club has you as over 18, so no prizes. you can still ship."
            : user.eligibility === "blocked_rejected"
              ? "Hack Club couldn't verify you. email us if that's wrong."
              : "you need this before you can ship. about five minutes.",
      href: needsVerify ? HCA_VERIFY_URL : null,
      action: "verify",
    },
    {
      label: "add a shipping address",
      done: hasAddress,
      hint:
        hasAddress === null
          ? "couldn't reach Hack Club. sign out and back in if this keeps happening."
          : "you need one on your Hack Club account to ship. we use your default.",
      href: hasAddress === false ? HCA_ADDRESSES_URL : null,
      action: "add address",
    },
  ];
  const todo = steps.filter((s) => s.done !== true);
  const live = steps.findIndex((s) => s.done === false);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <H1
          sub={
            started && !left
              ? returned.length > 0
                ? `a reviewer sent ${returned.length === 1 ? "one of your ships" : `${returned.length} of your ships`} back. you can still fix and resubmit, and resubmissions get reviewed first.`
                : "new ships aren't being taken, but anything sent back can still be fixed and resubmitted."
              : undefined
          }
        >
          {!started ? `starts ${startLabel}` : left ?? "shipping is closed"}
        </H1>
        {(left || user.role === "admin") && (
          <PixelLink href="/app/ship" className="mb-[clamp(1.25rem,2vw,32px)] text-[1.1rem]">
            ship a project →
          </PixelLink>
        )}
      </div>

      {todo.length > 0 && (
        <section className="border-t-4 border-rule pt-4">
          <h2 className="text-[1.25rem] font-semibold tracking-tight">left to set up</h2>
          <ol className="mt-3 grid grid-cols-1 gap-x-[clamp(1.5rem,3vw,56px)] md:grid-cols-3">
            {todo.map((s) => {
              const isLive = s === steps[live];
              return (
                <li key={s.label} className="flex items-start gap-3 border-b-2 border-panel-border py-3 last:border-0 md:border-0">
                  <span
                    aria-hidden
                    className={`mt-[0.2em] size-5 shrink-0 rounded-[4px] border-2 bg-white ${isLive ? "border-black" : "border-panel-border"}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold tracking-tight">{s.label}</span>
                    <span className="mt-0.5 block text-sm font-medium leading-snug text-black/60">{s.hint}</span>
                    {s.href && (
                      <a
                        href={s.href}
                        target={s.href.startsWith("http") ? "_blank" : undefined}
                        rel={s.href.startsWith("http") ? "noreferrer" : undefined}
                        className="mt-2 inline-block text-sm font-semibold underline decoration-1 underline-offset-[0.25em] hover:decoration-2"
                      >
                        {s.action} {s.href.startsWith("http") ? "↗" : "→"}
                      </a>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {shown.length > 0 && (
        <section className={`${todo.length > 0 ? "mt-[clamp(1.5rem,3vw,56px)] " : ""}border-t-4 border-rule pt-4`}>
          <h2 className="text-[1.25rem] font-semibold tracking-tight">your ships</h2>
          <ul className="mt-4 grid grid-cols-1 gap-[clamp(12px,1.25vw,24px)] sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((s) => (
              <li key={s.id}>
                <Link href={`/app/ships/${s.id}`} className="card block overflow-hidden transition-transform hover:-translate-y-0.5">
                  <div className="relative m-[10px] mb-0 aspect-[268/200] overflow-hidden rounded-[8px] bg-ink">
                    <AppFrame uri={s.dataUri} title={s.title} className="pointer-events-none" />
                  </div>
                  <div className="px-4 pb-4 pt-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[1.1rem] font-semibold leading-tight tracking-tight">{s.title}</p>
                      <StatePill state={s.state} />
                    </div>
                    <ByteMeter bytes={s.bytes} className="mt-3" />
                    <p className="mt-2 text-sm font-medium text-black/50">
                      {s.state === "approved" ? (
                        <>
                          <span className="font-pixel text-black">{s.awardedBites} BITES</span> for <Hours seconds={s.awardedSeconds ?? 0} />
                        </>
                      ) : (
                        <>
                          <Hours seconds={s.claimedSeconds} /> · shipped {when(s.createdAt)}
                        </>
                      )}
                    </p>
                  </div>
                </Link>
                {returned.includes(s) && (
                  <PixelLink href={`/app/ship?from=${s.id}`} variant="dark" className="mt-3">
                    resubmit →
                  </PixelLink>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!user.referralRevokedAt && (
        <section className={`${todo.length > 0 || shown.length > 0 ? "mt-[clamp(1.5rem,3vw,56px)] " : ""}border-t-4 border-rule pt-4`}>
          <h2 className="text-[1.25rem] font-semibold tracking-tight">invite friends</h2>
          <p className="mt-1 max-w-[60ch] font-medium leading-snug text-black/60">
            get {BITE_LABEL} for each friend you&apos;ve invited to SHRINK! only if they&apos;ve shipped a project :p
          </p>
          {referrals ? (
            <div className="mt-3 grid grid-cols-1 items-center gap-x-[clamp(1.5rem,3vw,56px)] gap-y-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <CopyLink url={`${origin}/r/${user.referralCode}`} className="max-w-[560px]" />
              <p className="text-sm font-medium text-black/60">
                <span className="font-pixel text-[1.1rem] text-black">{referrals.people.length}</span> signed up ·{" "}
                <span className="font-pixel text-[1.1rem] text-black">{referrals.people.filter((p) => p.status !== "joined").length}</span>{" "}
                shipped · <span className="font-pixel text-[1.1rem] text-black">{referrals.earned}</span> BITES earned ·{" "}
                <Link href="/app/invite" className="font-semibold text-black underline decoration-1 underline-offset-[0.25em] hover:decoration-2">
                  who&apos;s joined →
                </Link>
              </p>
            </div>
          ) : (
            <div className="mt-3">
              <GetLink />
            </div>
          )}
        </section>
      )}

      <section className="mt-[clamp(1.5rem,3vw,56px)] border-t-4 border-rule pt-4">
        <h2 className="text-[1.25rem] font-semibold tracking-tight">
          examples
        </h2>
        <ul className="mt-4 grid grid-cols-2 gap-[clamp(10px,1vw,20px)] sm:grid-cols-3 lg:grid-cols-6">
          {EXAMPLES.slice(1, 7).map((e) => (
            <li key={e.title}>
              <ProjectCard {...e} />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
