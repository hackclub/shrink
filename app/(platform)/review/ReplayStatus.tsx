"use client";

import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

import { getServerStatus, getStatus, subscribe, type ReplayState } from "./recorder";

const LOOK: Record<ReplayState, { dot: string; label: string }> = {
  off: { dot: "bg-muted-foreground/40", label: "Not recording" },
  starting: { dot: "bg-muted-foreground animate-pulse", label: "Starting" },
  ok: { dot: "bg-red-500", label: "Recording" },
  retrying: { dot: "bg-amber-500 animate-pulse", label: "Retrying" },
  failed: { dot: "bg-destructive", label: "Not recording" },
};

export function useReplayStatus() {
  return useSyncExternalStore(subscribe, getStatus, getServerStatus);
}

// The desk's recording light. Reviewers are told they're recorded, and see when it breaks.
export default function ReplayStatus() {
  const s = useReplayStatus();
  const look = LOOK[s.state];
  return (
    <span
      role="status"
      title={[s.error, s.pending > 1 ? `${s.pending} chunks waiting to upload` : null].filter(Boolean).join("\n") || "This desk session is being recorded."}
      className={cn("inline-flex items-center gap-1 rounded px-1 text-xs", s.state === "failed" ? "bg-destructive/10 text-destructive" : "text-muted-foreground")}
    >
      <span className={cn("size-1.5 rounded-full", look.dot)} />
      {look.label}
    </span>
  );
}
