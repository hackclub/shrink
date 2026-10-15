"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import Barcode from "@/app/components/Barcode";
import PixelButton from "@/app/components/PixelButton";
import { ByteMeter, Notice } from "@/app/components/ui/bits";
import { BADGES, BADGE_BY_SLUG, BASE_CAP, MAX_URI_BYTES, MIN_SHIP_SECONDS, REPO_URL, bitesFor, byteLength, capFor, hm } from "@/lib/program";

import { shipAction, type ShipFormState } from "./actions";
import BadgePicker from "./BadgePicker";
import { FlowHm, Num } from "./Flow";
import ProjectPicker from "./ProjectPicker";
import ScanPanel from "./ScanPanel";
import { draftKey, loadDraft, saveDraft } from "./draft";

type HackatimeRow = { name: string; seconds: number; used: boolean };

type Initial = {
  id: string;
  title: string;
  description: string;
  dataUri: string;
  sourceUrl: string;
  hackatimeProjects: string[];
  claimedBadges: string[];
  reviewerNote: string | null;
};

const STEPS = ["paste", "describe", "hours", "ship"] as const;

export default function ShipForm({
  hackatime,
  initial,
  preselect,
  bypass = false,
}: {
  hackatime: HackatimeRow[] | null;
  initial: Initial | null;
  preselect: string | null;
  // Admins skip the hours minimum and blocking scans, to try the flow.
  bypass?: boolean;
}) {
  const [state, action, pending] = useActionState<ShipFormState, FormData>(shipAction, { error: null });
  const [rawStep, setStep] = useState(0);
  const [uri, setUri] = useState(initial?.dataUri ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [sourceUrl, setSourceUrl] = useState(initial?.sourceUrl ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set(initial?.hackatimeProjects ?? (preselect ? [preselect] : [])));
  const [badges, setBadges] = useState<Set<string>>(new Set(initial?.claimedBadges ?? []));

  // Saving waits for the restore so the empty first render never overwrites the draft.
  const key = draftKey(initial?.id ?? null);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const d = loadDraft(key);
    if (d) {
      const usable = new Set((hackatime ?? []).filter((p) => !p.used).map((p) => p.name));
      /* eslint-disable react-hooks/set-state-in-effect -- restoring browser-only state after hydration */
      if (typeof d.uri === "string") setUri(d.uri);
      if (typeof d.title === "string") setTitle(d.title);
      if (typeof d.description === "string") setDescription(d.description);
      if (typeof d.sourceUrl === "string") setSourceUrl(d.sourceUrl);
      if (Array.isArray(d.projects)) setSelected(new Set(d.projects.filter((p) => usable.has(p))));
      if (Array.isArray(d.badges)) setBadges(new Set(d.badges.filter((b) => BADGE_BY_SLUG.has(b))));
      if (typeof d.step === "number") setStep(d.step);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const trimmed = uri.trim();
  const bytes = useMemo(() => byteLength(trimmed), [trimmed]);
  const uriProblem = !trimmed
    ? "paste a data URI to continue"
    : /[\r\n]/.test(trimmed)
      ? "it has a line break in it. a data URI is one line."
      : !/^data:text\/html/i.test(trimmed)
        ? "it has to start with data:text/html"
        : bytes > MAX_URI_BYTES
          ? `${(bytes - MAX_URI_BYTES).toLocaleString()} bytes over. shrink it!`
          : null;

  const descLeft = 20 - description.trim().length;
  const sourceOk = REPO_URL.test(sourceUrl.trim());
  const aboutProblem = !title.trim()
    ? "give it a title"
    : descLeft > 0
      ? "describe it in a sentence or two"
      : !sourceUrl.trim()
        ? "add a link to the repo"
        : !sourceOk
          ? "link the repo itself, like github.com/you/project"
        : null;

  const picked = (hackatime ?? []).filter((p) => selected.has(p.name));
  const seconds = picked.reduce((s, p) => s + p.seconds, 0);
  const badgeList = [...badges];
  const cap = capFor(badgeList);
  const estimate = seconds >= MIN_SHIP_SECONDS ? bitesFor(seconds, badgeList) : 0;
  const hoursProblem =
    hackatime === null
      ? "Hackatime needs fixing first"
      : picked.length === 0
        ? "pick at least one project"
        : seconds < MIN_SHIP_SECONDS && !bypass
          ? `that's ${hm(seconds)}. ships need at least ${hm(MIN_SHIP_SECONDS)}.`
          : null;

  const problems = [uriProblem, aboutProblem, hoursProblem, null];
  const reachable = problems.findIndex((p) => p !== null);
  const furthest = reachable === -1 ? 3 : reachable;
  const step = Math.min(rawStep, furthest);

  useEffect(() => {
    if (!restored) return;
    saveDraft(key, { step, uri, title, description, sourceUrl, projects: [...selected], badges: [...badges] });
  }, [restored, key, step, uri, title, description, sourceUrl, selected, badges]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  const go = (i: number) => {
    setStep(Math.max(0, Math.min(i, furthest)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const [scanBlocked, setScanBlocked] = useState<boolean | null>(null);
  const scanInput = useMemo(
    () => ({ dataUri: trimmed, sourceUrl: sourceUrl.trim(), hackatimeProjects: [...selected].sort() }),
    [trimmed, sourceUrl, selected],
  );

  const label = (
    <Label
      title={title.trim()}
      uri={trimmed}
      bytes={bytes}
      projects={picked.map((p) => p.name)}
      seconds={seconds}
      badges={badgeList}
      estimate={estimate}
      cap={cap}
      step={step}
      onEdit={go}
    />
  );

  return (
    <form
      action={action}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target instanceof HTMLInputElement && step < 3) {
          e.preventDefault();
          if (!problems[step]) go(step + 1);
        }
      }}
      className="grid grid-cols-1 items-start gap-x-[clamp(2rem,4vw,80px)] gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]"
    >
      {initial && <input type="hidden" name="reship_of" value={initial.id} />}

      <div className="min-w-0">
        <Rail step={step} furthest={furthest} onGo={go} />

        <section hidden={step !== 0} aria-label="paste your app">
          <StepHead title="paste your app" />

          {initial?.reviewerNote && (
            <div className="mb-5 rounded-[10px] bg-ink px-4 py-3 text-white">
              <p className="text-sm font-medium text-white/60">what the reviewer said</p>
              <p className="mt-1 whitespace-pre-wrap font-medium leading-relaxed">{initial.reviewerNote}</p>
            </div>
          )}

          <label className="sr-only" htmlFor="data_uri">
            Data URI
          </label>
          <textarea
            id="data_uri"
            name="data_uri"
            rows={9}
            spellCheck={false}
            autoFocus={!initial}
            value={uri}
            onChange={(e) => setUri(e.target.value)}
            placeholder="data:text/html,<body bgcolor=0 text=white><canvas id=c>…"
            aria-invalid={trimmed.length > 0 && uriProblem !== null}
            className="input font-mono text-[0.8rem] leading-relaxed break-all"
          />
          <ByteMeter bytes={bytes} className="mt-3" />

          {trimmed && uriProblem && (
            <p id="uri-status" role="alert" className="mt-3 font-medium text-[#c1121f]">
              {uriProblem}
            </p>
          )}

          <StepNav problem={uriProblem} onNext={() => go(1)} />
        </section>

        <section hidden={step !== 1} aria-label="describe it" className="flex flex-col gap-5">

          <div>
            <label className="label" htmlFor="title">
              title
            </label>
            <input
              id="title"
              name="title"
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input text-[1.15rem]"
              placeholder="Flappy square"
            />
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-3">
              <label className="label" htmlFor="description">
                description
              </label>
              {descLeft > 0 && description.length > 0 && (
                <span className="mb-[0.45rem] font-mono text-xs text-black/50">{descLeft} more</span>
              )}
            </div>
            <textarea
              id="description"
              name="description"
              maxLength={2000}
              rows={6}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input"
              placeholder="A four-key rhythm game. The beat comes from a seeded PRNG, so there's no audio data. Squeezing the UI in was the worst part."
            />
          </div>

          <div>
            <label className="label" htmlFor="source_url">
              source repo
            </label>
            <input
              id="source_url"
              name="source_url"
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              aria-invalid={sourceUrl.trim().length > 0 && !sourceOk}
              className="input font-mono text-sm"
              placeholder="https://github.com/you/tiny-thing"
            />
          </div>

          <StepNav problem={aboutProblem} onBack={() => go(0)} onNext={() => go(2)} />
        </section>

        <section hidden={step !== 2} aria-label="hours">

          <fieldset>
            <legend className="sr-only">Hackatime projects</legend>
            {hackatime === null ? (
              <Notice>
                We can&apos;t read your Hackatime.{" "}
                <a href="/api/auth/hackatime/start?next=/app/ship" className="underline">
                  Link it again
                </a>
                .
              </Notice>
            ) : hackatime.length === 0 ? (
              <Notice>Nothing on Hackatime yet. Code with the editor plugin on, then come back.</Notice>
            ) : (
              <ProjectPicker projects={hackatime} selected={selected} onToggle={(name) => toggle(selected, setSelected, name)} />
            )}
          </fieldset>

          <fieldset className="mt-10">
            <legend className="label mb-3">skill badges</legend>
            <BadgePicker badges={BADGES} selected={badges} onToggle={(slug) => toggle(badges, setBadges, slug)} />
          </fieldset>

          <StepNav problem={hoursProblem} onBack={() => go(1)} onNext={() => go(3)} />
        </section>

        <section hidden={step !== 3} aria-label="ship it">
          <StepHead title={initial ? "ready to resubmit?" : "ready to ship?"} />

          <div className="mb-6">
            <ScanPanel input={scanInput} active={step === 3} onBlocked={setScanBlocked} />
          </div>

          <div className="mb-6 lg:hidden">{label}</div>

          {state.error && (
            <div className="mb-5">
              <Notice>{state.error}</Notice>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4 border-t-2 border-panel-border pt-5">
            <BackButton onClick={() => go(2)} />
            <PixelButton type="submit" variant="dark" disabled={pending || furthest < 3 || (scanBlocked !== false && !bypass)} className="text-[1.35rem]">
              {pending ? (initial ? "resubmitting…" : "shipping…") : initial ? "resubmit →" : "ship it →"}
            </PixelButton>
          </div>
        </section>
      </div>

      <aside className="hidden lg:sticky lg:top-6 lg:block" aria-label="Shipping label">
        {label}
      </aside>
    </form>
  );
}

function Rail({ step, furthest, onGo }: { step: number; furthest: number; onGo: (i: number) => void }) {
  return (
    <ol className="mb-[clamp(1.5rem,3vw,48px)] flex items-center gap-2">
      {STEPS.map((name, i) => {
        const current = i === step;
        const done = i !== step && i < furthest;
        const open = i <= furthest;
        return (
          <li key={name} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
            <button
              type="button"
              onClick={() => onGo(i)}
              disabled={!open}
              aria-current={current ? "step" : undefined}
              className="group flex shrink-0 items-center gap-2 disabled:cursor-not-allowed"
            >
              <span
                className={`grid size-8 place-content-center rounded-[6px] border-2 font-pixel text-[1.05rem] leading-none transition-colors ${
                  current
                    ? "border-black bg-accent text-black"
                    : done
                      ? "border-black bg-black text-white group-hover:bg-accent group-hover:text-black"
                      : "border-panel-border bg-white text-black/40"
                }`}
              >
                {i + 1}
              </span>
              <span
                className={`hidden text-sm font-semibold tracking-tight sm:inline ${current ? "text-black" : open ? "text-black/70 group-hover:text-black" : "text-black/35"}`}
              >
                {name}
              </span>
            </button>
            {i < STEPS.length - 1 && <span aria-hidden className={`h-[2px] min-w-3 flex-1 ${i < furthest ? "bg-black" : "bg-panel-border"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

function StepHead({ title }: { title: string }) {
  return <h2 className={`mb-5 text-[clamp(1.6rem,2.4vw,2.5rem)] font-semibold leading-[1.1] tracking-tight`}>{title}</h2>;
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-sm font-semibold text-black/60 underline decoration-1 underline-offset-[0.25em] hover:text-black">
      ← back
    </button>
  );
}

function StepNav({ problem, onBack, onNext }: { problem: string | null; onBack?: () => void; onNext: () => void }) {
  return (
    <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t-2 border-panel-border pt-5">
      {onBack ? <BackButton onClick={onBack} /> : <span />}
      <div className="flex items-center gap-4">
        {problem && <span className="hidden text-sm font-medium text-black/50 sm:inline">{problem}</span>}
        <PixelButton variant="dark" onClick={onNext} disabled={problem !== null} className="text-[1.1rem]">
          next →
        </PixelButton>
      </div>
    </div>
  );
}

function Label({
  title,
  uri,
  bytes,
  projects,
  seconds,
  badges,
  estimate,
  cap,
  step,
  onEdit,
}: {
  title: string;
  uri: string;
  bytes: number;
  projects: string[];
  seconds: number;
  badges: string[];
  estimate: number;
  cap: number;
  step: number;
  onEdit: (step: number) => void;
}) {
  const blank = <span className="text-black/25">—</span>;
  const row = (name: string, target: number, value: React.ReactNode) => (
    <div className="py-3">
      <dt className="flex items-center justify-between">
        <span className="text-xs font-semibold text-black/50">{name}</span>
        {target < step && (
          <button type="button" onClick={() => onEdit(target)} className="text-xs font-semibold underline decoration-1 underline-offset-2 hover:decoration-2">
            edit
          </button>
        )}
      </dt>
      <dd className="mt-1">{value}</dd>
    </div>
  );

  return (
    <div className="overflow-hidden rounded-[14px] border-2 border-black bg-white">
      <div className="hazard-thin" aria-hidden />
      <div className="flex items-start justify-between px-5 pt-4">
        <span className="wordmark text-[1.9rem] leading-none tracking-tight">SHRINK</span>
      </div>
      <dl className="mt-2 divide-y-2 divide-dashed divide-panel-border px-5">
        {row("contents", 1, title ? <p className="text-[1.15rem] font-semibold leading-tight tracking-tight">{title}</p> : blank)}
        {row("weight", 0, bytes > 0 ? <ByteMeter bytes={bytes} /> : blank)}
        {row(
          "hours",
          2,
          projects.length > 0 ? (
            <p className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate font-mono text-sm">{projects.join(", ")}</span>
              <span className="shrink-0 font-mono text-sm tabular-nums"><FlowHm seconds={seconds} /></span>
            </p>
          ) : (
            blank
          ),
        )}
        {row(
          "BITE cap",
          2,
          <ul className="flex flex-col gap-1 font-mono text-sm">
            <Leader name="base" value={String(BASE_CAP)} muted />
            {badges.map((b) => (
              <Leader key={b} name={BADGE_BY_SLUG.get(b)?.title ?? b} value={`+${BADGE_BY_SLUG.get(b)?.bites ?? 0}`} />
            ))}
            {badges.length > 0 && (
              <li className="mt-1 flex items-baseline justify-between border-t-2 border-black pt-1.5 font-semibold">
                <span>cap</span>
                <span className="tabular-nums">
                  <Num value={cap} />
                </span>
              </li>
            )}
          </ul>,
        )}
      </dl>
      <div className="mt-1 flex items-end justify-between gap-3 border-t-2 border-black px-5 py-4">
        <span className="text-xs font-semibold text-black/50">if approved</span>
        <span className={`font-pixel text-[2.6rem] leading-none ${estimate ? "" : "text-black/25"}`}>≈ <Num value={estimate} /> BITES</span>
      </div>
      {estimate === 0 && (
        <p className="px-5 pb-3 text-xs text-black/50">Under an hour earns 0 BITES. It&apos;s 1 per hour, rounded down (.9 rounds up), so keep building!</p>
      )}
      <Barcode value={uri} />
    </div>
  );
}

function Leader({ name, value, muted = false }: { name: string; value: string; muted?: boolean }) {
  return (
    <li className={`fade-in flex items-baseline gap-2 ${muted ? "text-black/50" : ""}`}>
      <span className="shrink-0">{name}</span>
      <span aria-hidden className="min-w-4 flex-1 -translate-y-[0.3em] border-b-2 border-dotted border-black/25" />
      <span className="shrink-0 tabular-nums">{value}</span>
    </li>
  );
}
