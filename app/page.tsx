import Image from "next/image";
import { Suspense } from "react";

import AuthErrorInner from "./components/AuthError";
import AuthPopupLink from "./components/AuthPopupLink";
import BrowserMock from "./components/BrowserMock";
import HackClubFlag from "./components/HackClubFlag";
import { pixelButtonClass, pixelButtonVariants } from "./components/PixelButton";
import ProjectCarousel from "./components/ProjectCarousel";
import RewardPool from "./components/RewardPool";
import ScrollMarquee from "./components/ScrollMarquee";
import SkillBadge from "./components/SkillBadge";
import Wordmark from "./components/Wordmark";
import { EXAMPLES } from "@/lib/examples";
import { BADGES, BASE_CAP, SHOP_REWARDS } from "@/lib/program";

const IDEAS: [string, string][] = [
  ["A synthesizer:", " build a playable instrument with UI in 3KB"],
  ["A audio visualizer:", " mic input, something reacts to your voice or music"],
  ["A rhythm game:", " four keys and procedural beats!"],
  ["A morse code translator:", " type text and hear it beeped back at you!"],
  ["A tiny game:", " snake or pong? and use the Web Audio API!"],
];

const darkPixel = pixelButtonClass.replace(pixelButtonVariants.light, pixelButtonVariants.dark);

const CODE_LINE = "data:text/html,<body bgcolor=0 text=white>";

function AuthError() {
  return (
    <Suspense fallback={null}>
      <AuthErrorInner />
    </Suspense>
  );
}

function Rule() {
  return <hr className="h-1 w-full border-0 bg-rule" />;
}

function GlobeIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="inline-block size-[0.95em] -translate-y-[0.08em] align-middle"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2c3 3.3 3 16.7 0 20M12 2c-3 3.3-3 16.7 0 20" />
    </svg>
  );
}

export default function Home() {
  return (
    <main className="flex flex-1 flex-col bg-background text-foreground">
      <section className="relative overflow-hidden">
        <a
          href="https://hackclub.com/"
          aria-label="Hack Club"
          className="absolute top-[calc(clamp(40px,3.6vw,72px)+clamp(12px,1.4vw,28px))] left-[clamp(12px,1.6vw,32px)] z-10 block w-[clamp(96px,9vw,180px)] transition-transform duration-300 hover:-rotate-3"
        >
          <HackClubFlag className="block h-auto w-full" />
        </a>
        <div className="hazard hazard-top h-[clamp(40px,3.6vw,72px)] w-full" />
        <AuthPopupLink
          href="/login?next=/app"
          className="absolute top-[calc(clamp(40px,3.6vw,72px)+clamp(12px,1.4vw,28px))] right-[clamp(12px,1.6vw,32px)] z-10 font-mono text-[clamp(0.8rem,0.95vw,1.05rem)] underline decoration-1 underline-offset-[0.25em] hover:decoration-2"
        >
          sign in →
        </AuthPopupLink>
        <AuthError />

        <div className="flex flex-col sm:min-h-[calc(100svh-clamp(40px,3.6vw,72px))] items-center justify-center px-[var(--gutter)] pt-24 pb-[clamp(1.5rem,4vh,76px)] text-center sm:pt-[clamp(1.5rem,4vh,76px)]">
          <p className="fade-in text-balance text-[length:max(12px,min(var(--text-tagline),3.95vw))] leading-normal">
            storage is more expensive than ever, it&rsquo;s time to...
          </p>

          <Wordmark className="mt-[clamp(0.75rem,2.5vh,44px)] max-w-[min(1000px,80svh)] sm:w-[62%]" />

          <p className="flicker-in mt-[clamp(1rem,3vh,46px)] text-[length:var(--text-sub)] font-medium leading-normal">
            fit a one-liner app under{" "}
            <span className="font-pixel font-medium">3kb</span>
            <span className="mx-[0.35em]">•</span>get cool stuff &amp; stickers
          </p>

          <div className="fade-in-late mt-[clamp(1.25rem,4vh,56px)] flex flex-wrap items-center justify-center gap-4">
            <AuthPopupLink href="/login?next=/app" className={`${darkPixel} cta-sweep text-[clamp(1rem,1.3vw,1.4rem)]`}>
              Start Now!
            </AuthPopupLink>
          </div>

          <a
            href="#how"
            aria-label="Scroll to learn how it works"
            className="fade-in-late mt-[clamp(1rem,3vh,40px)] inline-block w-[clamp(64px,5.5vw,104px)] transition-transform duration-300 hover:translate-y-1"
          >
            <Image
              src="/design/chevron-down.svg"
              alt=""
              width={155}
              height={49}
              className="h-auto w-full"
            />
          </a>
        </div>
      </section>

      <Rule />
      <div>
        <section
          id="how"
          className="grid grid-cols-1 lg:h-[clamp(440px,60svh,640px)] lg:grid-cols-[1fr_4px_1fr]"
        >
          <div className="flex flex-col justify-center bg-gradient-to-b from-[rgba(246,194,1,0.02)] to-[rgba(246,194,1,0.15)] px-[var(--gutter)] py-[clamp(2.5rem,4.5vw,88px)]">
            <h2 className="text-[length:var(--text-display)] font-semibold leading-[1.25] tracking-tight">
              Screw Hosting.
              <br />
              Screw Files.
            </h2>
            <p className="mt-[clamp(1rem,1.5vw,28px)] max-w-[460px] text-[length:var(--text-lead)] font-medium leading-[1.371] text-black/70">
              Data URI is a <GlobeIcon /> web standard that allows you to{" "}
              <mark className="bg-accent px-[0.08em] text-black/90">
                embed inline data
              </mark>{" "}
              (like documents, images, or code) directly into a text string
              instead of linking to an external server.
            </p>
          </div>

          <div className="hidden bg-rule lg:block" aria-hidden />
          <div className="h-1 w-full bg-rule lg:hidden" aria-hidden />

          <BrowserMock />
        </section>
      </div>

      <Rule />

      <ScrollMarquee
        text={CODE_LINE}
        className="py-[clamp(1rem,2vw,40px)] font-mono text-[clamp(1.5rem,3.4vw,4rem)] font-light leading-normal"
      />

      <Rule />

      <section className="relative overflow-hidden">
        <div className="checkerboard absolute inset-0" aria-hidden />
        <div className="relative px-[var(--gutter)] pt-[clamp(2.5rem,4.5vw,88px)] pb-[clamp(3rem,7vw,136px)]">
          <h2 className="text-[length:var(--text-display)] font-semibold leading-[1.25] tracking-tight">
            How does it work?
          </h2>
          <p className="mt-[clamp(1.25rem,2.2vw,42px)] max-w-[1100px] text-[length:var(--text-body)] font-medium leading-[1.371] text-black/85">
            <span className="wordmark">SHRINK</span> is a{" "}
            <a
              href="https://ysws.hackclub.com"
              className="underline decoration-1 underline-offset-[0.12em] hover:decoration-2"
            >
              You Ship We Ship
            </a>{" "}
            where you create a one-line web app within 3kb, without relying on
            external resources (like images on a CDN, or script hosted
            elsewhere), and use creative things like maths to make things
            appear (with canvas) and sounds to play (with the web audio API).
          </p>

          <div className="mt-[clamp(1.25rem,1.8vw,36px)] max-w-[1100px] text-[length:var(--text-body)] font-medium leading-[1.84] text-black/85">
            <p>Don&rsquo;t know what to make? What about:</p>
            <ul className="list-disc ps-[1.5em]">
              {IDEAS.map(([lead, rest]) => (
                <li key={lead}>
                  <span className="font-semibold">{lead}</span>
                  {rest}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <Rule />

      <section className="relative overflow-hidden">
        <div className="diag-stripes absolute inset-0" aria-hidden />
        <div className="relative px-[var(--gutter)] pt-[clamp(2.5rem,3.5vw,66px)] pb-[clamp(1.5rem,2.5vw,48px)]">
          <h2 className="text-[length:var(--text-display)] font-semibold leading-[1.25] tracking-tight">
            And earn awesome prizes!
          </h2>

          <p className="mt-[clamp(0.5rem,0.3vw,6px)] max-w-[1100px] text-[length:var(--text-body)] font-medium leading-[1.371] text-black/85">
            You earn <span className="font-pixel">1 BITE</span> per hour for up to{" "}
            {BASE_CAP} per project! However implementing specific features raises
            your cap :p
          </p>

          <div className="mt-[clamp(1rem,1.6vw,30px)] -mx-[var(--gutter)]">
            <RewardPool rewards={SHOP_REWARDS} />
          </div>

          <p className="mt-[clamp(0.5rem,0.8vw,14px)] text-center text-[clamp(0.8rem,0.95vw,1.125rem)] font-medium leading-[1.6] text-black/50">
            Plus a free <span className="wordmark">SHRINK</span> sticker sheet with your first ship!
          </p>
        </div>
      </section>

      <Rule />

      <section className="overflow-hidden px-[var(--gutter)] pt-[clamp(2.5rem,4.2vw,82px)] pb-[clamp(2.5rem,5.4vw,104px)]">
        <h2 className="text-[length:var(--text-display)] font-semibold leading-[1.25] tracking-tight">
          Still stuck? Check these out:
        </h2>
        <ProjectCarousel projects={EXAMPLES} />
      </section>

      <Rule />

      <section className="px-[var(--gutter)] pt-[clamp(2.5rem,3.5vw,66px)] pb-[clamp(4rem,14vw,260px)]">
        <h2 className="text-[length:var(--text-display)] font-semibold leading-[1.25] tracking-tight">
          Get Skill Badges
        </h2>
        <p className="mt-[clamp(0.5rem,0.3vw,6px)] max-w-[1100px] text-[length:var(--text-body)] font-medium leading-[1.371] text-black/85">
          Use them to increase the cap of BITES you can get per project!
          <span className="block text-[0.8em] text-black/50">
            Hover or tap a badge to see how to earn it.
          </span>
        </p>
        <div className="mt-[clamp(1.5rem,2.4vw,46px)] grid max-w-[1080px] grid-cols-2 gap-[clamp(12px,1.4vw,28px)] sm:grid-cols-4">
          {BADGES.map((b) => (
            <SkillBadge key={b.slug} title={b.title} bites={b.bites} desc={b.desc} />
          ))}
        </div>
        <div className="mt-[clamp(2rem,4vw,72px)] flex flex-wrap items-center gap-4">
          <AuthPopupLink href="/login?next=/app" className={`${darkPixel} cta-sweep text-[clamp(1rem,1.3vw,1.4rem)]`}>
            Start Now!
          </AuthPopupLink>
        </div>
      </section>

      <div className="px-[var(--gutter)] pb-[clamp(0.75rem,1.2vw,24px)] text-center text-[clamp(0.8rem,0.95vw,1.125rem)] font-medium leading-[1.6] text-black/50">
        <p>
          Program by{" "}
          <a
            href="https://hackclub.enterprise.slack.com/team/U06P19MEXEZ"
            className="underline decoration-1 underline-offset-[0.12em] hover:decoration-2"
          >
            @anson
          </a>
        </p>
        <p>
          <a
            href="https://hackclub.com/privacy-and-terms"
            className="decoration-1 underline-offset-[0.12em] hover:underline"
          >
            Privacy and Terms
          </a>
          <span className="mx-[0.35em]">•</span>
          <a
            href="https://forms.hackclub.com/bounty"
            className="decoration-1 underline-offset-[0.12em] hover:underline"
          >
            Fulfilment Bounty
          </a>
          <span className="mx-[0.35em]">•</span>
          <a
            href="https://security.hackclub.com"
            className="decoration-1 underline-offset-[0.12em] hover:underline"
          >
            Security
          </a>
        </p>
      </div>

      <footer className="hazard relative grid h-[clamp(56px,3.8vw,72px)] grid-cols-[1fr_auto_1fr] bg-ink">
        <div className="hazard-l" aria-hidden />
        <p className="relative z-10 flex h-full items-center whitespace-nowrap px-[clamp(1rem,5vw,96px)] text-center text-[length:var(--text-sub)] font-medium leading-normal text-white">
          made with &lt;3 by teens in Hack Club
        </p>
        <div className="hazard-r" aria-hidden />
      </footer>
    </main>
  );
}
