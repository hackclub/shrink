"use client";

import { Check, Copy, Loader2, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { AppFrame, decodeHtml } from "@/app/components/ui/bits";
import type { RepoView } from "@/lib/server/scan";
import { cn } from "@/lib/utils";

import { loadFrameRecorder } from "./frame-recorder";
import { Lines, RepoPanes } from "./Repo";

type Tab = "preview" | "source" | "readme" | "files";
const TABS: { id: Tab; label: string }[] = [
  { id: "preview", label: "Preview" },
  { id: "source", label: "Source" },
  { id: "readme", label: "README" },
  { id: "files", label: "Repo" },
];

// The middle of the desk: the shipped app, its HTML, and the repo, as tabs that fill the pane.
// J/K move through the queue, 1-4 switch tabs.
export default function Workspace({
  shipId,
  uri,
  title,
  repo,
  prevHref,
  nextHref,
}: {
  shipId: string;
  uri: string;
  title: string;
  // null when the ship has no source link.
  repo: Promise<RepoView | null> | null;
  prevHref: string | null;
  nextHref: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("preview");
  const [run, setRun] = useState(0);
  const [copied, setCopied] = useState(false);
  // The recorder that goes in the frame; the app waits for it so its start is on the recording.
  const [recorder, setRecorder] = useState<string | null>(null);
  const [navigating, startNav] = useTransition();
  const html = useMemo(() => decodeHtml(uri), [uri]);
  const enabled = (t: Tab) => (t === "readme" || t === "files" ? !!repo : true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable=true]")) return;
      const k = e.key.toLowerCase();
      const go = k === "j" ? nextHref : k === "k" ? prevHref : null;
      if (go) {
        e.preventDefault();
        startNav(() => router.push(go));
        return;
      }
      const t = TABS[Number(k) - 1];
      if (t && enabled(t.id)) {
        e.preventDefault();
        setTab(t.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // The pane can still be 0×0 when the frame would first load (styles streaming in, a client
  // navigation mid-layout), and an app that reads innerWidth once at startup then draws on a
  // 0×0 canvas, or throws, and never recovers. Hold the frame back until the pane has a size.
  const pane = useRef<HTMLDivElement>(null);
  const [sized, setSized] = useState(false);
  useEffect(() => {
    const el = pane.current;
    if (!el || sized) return;
    const check = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSized(true);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sized]);

  useEffect(() => {
    let live = true;
    loadFrameRecorder().then((s) => live && setRecorder(s));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = () =>
    navigator.clipboard.writeText(uri).then(
      () => setCopied(true),
      // No clipboard access: hand it over to copy by hand.
      () => window.prompt("Copy the data URI", uri),
    );

  const repoTab = tab === "readme" || tab === "files";

  return (
    <div className="relative flex h-[75svh] min-h-0 flex-col lg:h-auto lg:flex-1">
      {navigating && <div className="absolute inset-x-0 top-0 z-10 h-0.5 animate-pulse bg-foreground" />}
      {/* Browser-style tabs: the open one joins the pane below by covering the bar's bottom rule. */}
      <div className="relative flex h-10 shrink-0 items-end gap-1 overflow-x-auto bg-muted/50 px-2 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            disabled={!enabled(t.id)}
            onClick={() => setTab(t.id)}
            title={`${t.label} (${i + 1})`}
            aria-pressed={tab === t.id}
            className={cn(
              "shrink-0 font-medium whitespace-nowrap transition-colors disabled:opacity-40",
              tab === t.id
                ? "relative z-10 h-8 rounded-t-lg border border-b-0 bg-card px-3.5 text-foreground"
                : "mb-1 h-7 rounded-md px-3 text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
        {(tab === "preview" || tab === "source") && (
          <div className="ml-auto flex min-w-0 items-center gap-1 self-center">
            {tab === "preview" && (
              <span className="mr-1 hidden truncate text-xs text-muted-foreground 2xl:inline">Sandboxed, no network. Broken? Paste the URI into a new tab.</span>
            )}
            {tab === "preview" && (
              <ToolButton onClick={() => setRun((n) => n + 1)}>
                <RotateCw className="size-3.5" />
                Restart
              </ToolButton>
            )}
            <ToolButton onClick={copy}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy URI"}
            </ToolButton>
          </div>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {/* Kept mounted so switching tabs doesn't restart the app. */}
        <div ref={pane} className={cn("absolute inset-0 bg-white", tab !== "preview" && "invisible")}>
          {recorder !== null && sized && <AppFrame key={run} uri={uri} title={title} className="size-full" head={recorder} interactive focus={tab === "preview"} />}
        </div>
        {tab === "source" && (
          <div className="absolute inset-0 flex flex-col">
            <Lines text={html} />
          </div>
        )}
        {repo && (
          <div className={cn("absolute inset-0 flex flex-col", !repoTab && "hidden")}>
            <Suspense
              fallback={
                <p className="m-auto flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading repo
                </p>
              }
            >
              <RepoPanes shipId={shipId} repo={repo} tab={tab === "readme" ? "readme" : "files"} onOpenFile={() => setTab("files")} />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded px-2 text-xs whitespace-nowrap font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}
