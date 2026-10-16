"use client";

import { Check, Loader2, Undo2 } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { BADGES, BASE_CAP, bitesFor, capFor } from "@/lib/program";
import { cn } from "@/lib/utils";

import { decideAction, type DecisionState } from "./actions";
import { flushRecording, markRecording } from "./recorder";
import { useReplayStatus } from "./ReplayStatus";

// What's typed is kept per ship in localStorage, so clicking onto another ship (or a reload)
// doesn't lose a half-written message or justification. Gone once the decision goes through.
type Draft = { kind: "approve" | "reject"; hours: string; badges: string[]; message: string; note: string; at: number };
const DRAFT = "desk-draft:";
const DRAFT_TTL = 14 * 24 * 3600 * 1000;

function loadDraft(shipId: string): Draft | null {
  try {
    // Prune drafts for ships that got decided elsewhere.
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(DRAFT)) continue;
      const d = JSON.parse(localStorage.getItem(k) ?? "null") as Draft | null;
      if (!d || Date.now() - d.at > DRAFT_TTL) localStorage.removeItem(k);
    }
    return JSON.parse(localStorage.getItem(DRAFT + shipId) ?? "null");
  } catch {
    return null;
  }
}

function saveDraft(shipId: string, d: Omit<Draft, "at">) {
  try {
    localStorage.setItem(DRAFT + shipId, JSON.stringify({ ...d, at: Date.now() }));
  } catch {}
}

function clearDraft(shipId: string) {
  try {
    localStorage.removeItem(DRAFT + shipId);
  } catch {}
}

// Every decision has to be on the desk recording: upload what's buffered first, and
// don't decide if it can't get through. The server checks again (replayLive).
// The replay shows the press as "submit", and a "refused" right after if it didn't go through.
async function recordedDecide(prev: DecisionState, form: FormData): Promise<DecisionState> {
  const shipId = form.get("ship_id");
  markRecording("submit", { shipId, kind: form.get("kind") });
  const r = await flushRecording();
  if (!r.ok) {
    markRecording("refused", { shipId, error: "recording" });
    return { error: `Nothing was decided: the desk recording isn't reaching the server. ${r.error} Reload the page and try again.` };
  }
  form.set("replay_id", r.id);
  // Cleared up front: a decision that goes through redirects, so nothing after the call runs.
  const id = String(shipId);
  const draft = loadDraft(id);
  clearDraft(id);
  const res = await decideAction(prev, form);
  if (res.error) {
    markRecording("refused", { shipId, error: res.error });
    if (draft) saveDraft(id, draft);
  }
  return res;
}

export default function DecisionForm({
  shipId,
  nextId,
  filter,
  tab,
  prior,
  claimedSeconds,
  claimedBadges,
  isOwn,
  isAdmin,
  fraudMessage,
}: {
  shipId: string;
  nextId: string;
  // The desk's secondary-check filter, kept across the redirect to the next ship.
  filter: string;
  tab: string;
  // On an admin's second pass: the reviewer's call, which the form starts from.
  prior?: { kind: "approve" | "reject"; seconds: number; badges: string[]; message: string };
  claimedSeconds: number;
  claimedBadges: string[];
  isOwn: boolean;
  // Admins can award past the Hackatime hours, with a justification.
  isAdmin: boolean;
  // Set when the secondary check failed: the only way out is sending it back, with this prefilled.
  fraudMessage?: string;
}) {
  const [state, action, pending] = useActionState<DecisionState, FormData>(recordedDecide, { error: null });
  const replay = useReplayStatus();
  const maxHours = Math.round((claimedSeconds / 3600) * 10) / 10;
  const priorHours = prior?.kind === "approve" ? Math.round((prior.seconds / 3600) * 10) / 10 : null;
  const [hours, setHours] = useState(String(priorHours ?? maxHours));
  const [badges, setBadges] = useState<Set<string>>(new Set(prior?.kind === "approve" ? prior.badges : claimedBadges));
  const [kind, setKind] = useState<"approve" | "reject">(fraudMessage ? "reject" : (prior?.kind ?? "approve"));
  // Controlled, so neither a refused submit (React resets the form) nor a ship switch wipes them.
  const [message, setMessage] = useState(fraudMessage ?? prior?.message ?? "");
  const [note, setNote] = useState("");
  const [loaded, setLoaded] = useState(false);

  // localStorage only exists in the browser, so the draft comes in after hydration.
  useEffect(() => {
    const d = loadDraft(shipId);
    /* eslint-disable react-hooks/set-state-in-effect -- restoring browser-only state after hydration */
    if (d) {
      if (!fraudMessage) setKind(d.kind);
      setHours(d.hours);
      setBadges(new Set(d.badges));
      setMessage(d.message);
      setNote(d.note);
    }
    setLoaded(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [shipId, fraudMessage]);

  useEffect(() => {
    if (!loaded) return;
    // Nothing typed yet: no draft, so an untouched ship doesn't leave one behind.
    if (!note && message === (fraudMessage ?? prior?.message ?? "")) clearDraft(shipId);
    else saveDraft(shipId, { kind, hours, badges: [...badges], message, note });
  }, [loaded, shipId, kind, hours, badges, message, note, fraudMessage, prior?.message]);

  const h = Number(hours);
  const bites = Number.isFinite(h) && h > 0 ? bitesFor((isAdmin ? h : Math.min(h, maxHours)) * 3600, [...badges]) : 0;
  const cap = capFor([...badges]);
  const approving = kind === "approve";
  const over = isAdmin && approving && h * 3600 > claimedSeconds + 180;

  return (
    <form action={action} className="flex flex-1 flex-col">
      <input type="hidden" name="ship_id" value={shipId} />
      <input type="hidden" name="next_id" value={nextId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="f" value={filter} />
      <input type="hidden" name="tab" value={tab} />

      <div className="flex flex-col gap-3 px-4 py-3">
        {isOwn && <p className="rounded bg-muted px-2 py-1 text-xs">Your own ship. Only an admin can decide it.</p>}

        {fraudMessage ? (
          <p className="text-xs text-destructive">
            <span className="font-medium">Fraud check failed.</span> Read the note above, edit the message if needed, and send it back.
          </p>
        ) : (
          <div role="radiogroup" aria-label="Decision" className="grid grid-cols-2 gap-1 rounded-md bg-muted p-0.5">
            <Seg active={approving} onClick={() => setKind("approve")}>
              <Check className="size-3.5" /> Approve
            </Seg>
            <Seg active={!approving} onClick={() => setKind("reject")}>
              <Undo2 className="size-3.5" /> Send back
            </Seg>
          </div>
        )}

        {approving && (
          <>
            <div className="flex items-end gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="hours" className="text-xs font-normal text-muted-foreground">
                  Hours
                </Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    id="hours"
                    name="hours"
                    type="number"
                    step="0.1"
                    min="0.1"
                    max={isAdmin ? undefined : maxHours}
                    required
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    className="h-8 w-20 font-mono"
                  />
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    onClick={() => setHours(String(maxHours))}
                  >
                    of {maxHours}
                  </button>
                </div>
              </div>
              <p className="ml-auto text-right leading-tight">
                <span className="font-mono text-xl font-semibold tabular-nums">{bites}</span>
                <span className="block text-xs text-muted-foreground">
                  BITES · cap {cap}
                  {cap > BASE_CAP && ` (${BASE_CAP}+${cap - BASE_CAP})`}
                </span>
              </p>
            </div>
            {over && (
              <p className="mt-2 text-xs text-muted-foreground">More than Hackatime shows. As an admin you can award it, but say why in the justification.</p>
            )}
            {approving && h > 0 && bites === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">Under 0.9h earns 0 BITES. It&apos;s 1 per hour, rounded down (.9 rounds up).</p>
            )}

            <fieldset>
              <legend className="mb-1 text-xs text-muted-foreground">
                Badges <span className="opacity-70">· • = claimed</span>
              </legend>
              <div className="grid grid-cols-2 gap-x-4">
                {BADGES.map((b) => {
                  const id = `badge-${b.slug}`;
                  return (
                    <Label key={b.slug} htmlFor={id} className="flex cursor-pointer items-center gap-2 rounded py-1 text-sm font-normal">
                      <Checkbox
                        id={id}
                        name="badge"
                        value={b.slug}
                        checked={badges.has(b.slug)}
                        onCheckedChange={() => {
                          const n = new Set(badges);
                          if (n.has(b.slug)) n.delete(b.slug);
                          else n.add(b.slug);
                          setBadges(n);
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {b.title}
                        {claimedBadges.includes(b.slug) && (
                          <span className="ml-1 text-muted-foreground" title="Claimed by the author">
                            •
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">+{b.bites}</span>
                    </Label>
                  );
                })}
              </div>
            </fieldset>
          </>
        )}

        <Textarea
          name="message"
          aria-label="Message to the author"
          placeholder={approving ? "Message to the author (Slack DM)" : "What to fix (Slack DM to the author)"}
          required
          rows={3}
          maxLength={2000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="min-h-0 text-sm"
        />
        <Textarea
          name="internal_note"
          aria-label="Justification"
          placeholder={over ? "Justification (internal, required: why more than Hackatime shows)" : "Justification (internal)"}
          required={over}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-0 text-sm"
        />

        {replay.state === "failed" && (
          <p role="alert" className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
            <span className="font-medium">The desk isn&apos;t being recorded.</span> {replay.error} Decisions are blocked until it&apos;s back; reloading usually fixes it.
          </p>
        )}

        {state.error && (
          <p role="alert" className="text-xs font-medium text-destructive">
            {state.error}
          </p>
        )}
      </div>

      {/* Pinned, so the button is reachable however long the inspector gets. */}
      <div className="sticky bottom-0 mt-auto border-t bg-card px-4 py-3">
        <Button
          type="submit"
          disabled={pending || isOwn}
          variant={approving ? "default" : "destructive"}
          className={cn("w-full", approving && "bg-brand text-black hover:bg-brand/85")}
        >
          {pending ? <Loader2 className="animate-spin" /> : approving ? <Check /> : <Undo2 />}
          {prior && prior.kind === kind ? "Confirm: " : ""}
          {approving ? `Approve for ${bites} BITES` : "Send it back"}
        </Button>
      </div>
    </form>
  );
}

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center justify-center gap-1.5 rounded text-xs font-medium transition-colors",
        active ? "bg-card text-foreground shadow-sm dark:bg-input" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
