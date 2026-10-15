"use client";

import { Check, Loader2, Undo2 } from "lucide-react";
import { useActionState, useState } from "react";

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
  const res = await decideAction(prev, form);
  if (res.error) markRecording("refused", { shipId, error: res.error });
  return res;
}

export default function DecisionForm({
  shipId,
  nextId,
  filter,
  claimedSeconds,
  claimedBadges,
  isOwn,
  fraudMessage,
}: {
  shipId: string;
  nextId: string;
  // The desk's secondary-check filter, kept across the redirect to the next ship.
  filter: string;
  claimedSeconds: number;
  claimedBadges: string[];
  isOwn: boolean;
  // Set when the secondary check failed: the only way out is sending it back, with this prefilled.
  fraudMessage?: string;
}) {
  const [state, action, pending] = useActionState<DecisionState, FormData>(recordedDecide, { error: null });
  const replay = useReplayStatus();
  const maxHours = Math.round((claimedSeconds / 3600) * 10) / 10;
  const [hours, setHours] = useState(String(maxHours));
  const [badges, setBadges] = useState<Set<string>>(new Set(claimedBadges));
  const [kind, setKind] = useState<"approve" | "reject">(fraudMessage ? "reject" : "approve");

  const h = Number(hours);
  const bites = Number.isFinite(h) && h > 0 ? bitesFor(Math.min(h, maxHours) * 3600, [...badges]) : 0;
  const cap = capFor([...badges]);
  const approving = kind === "approve";

  return (
    <form action={action} className="flex flex-1 flex-col">
      <input type="hidden" name="ship_id" value={shipId} />
      <input type="hidden" name="next_id" value={nextId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="f" value={filter} />

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
                    max={maxHours}
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
          defaultValue={fraudMessage}
          className="min-h-0 text-sm"
        />
        <Textarea name="internal_note" aria-label="Justification" placeholder="Justification (internal)" rows={2} className="min-h-0 text-sm" />

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
      <div className="sticky bottom-0 mt-auto border-t bg-white px-4 py-3">
        <Button
          type="submit"
          disabled={pending || isOwn}
          variant={approving ? "default" : "destructive"}
          className={cn("w-full", approving && "bg-brand text-black hover:bg-brand/85")}
        >
          {pending ? <Loader2 className="animate-spin" /> : approving ? <Check /> : <Undo2 />}
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
        active ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
