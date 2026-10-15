// Active time on the review desk (see app/(platform)/review/recorder.ts).
// A gap between two interactions counts only if it's shorter than this; anything
// longer is idle and counts for nothing.
export const IDLE_MS = 90_000;
// Decisions made with less active time than this get flagged on the audit page.
export const FAST_REVIEW_MS = 45_000;

// rrweb custom event the recorder emits with each stretch of active time.
export const ACTIVE_TAG = "active";
export type ActivePayload = { ship: string | null; ms: number; from: number; to: number };

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
