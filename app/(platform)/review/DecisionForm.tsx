"use client";

import { useActionState, useState } from "react";

import PixelButton from "@/app/components/PixelButton";
import { Notice } from "@/app/components/ui/bits";
import { BADGES, BASE_CAP, bitesFor, capFor } from "@/lib/program";

import { decideAction, type DecisionState } from "./actions";

export default function DecisionForm({
  shipId,
  nextId,
  claimedSeconds,
  claimedBadges,
  isOwn,
  fraudMessage,
}: {
  shipId: string;
  nextId: string;
  claimedSeconds: number;
  claimedBadges: string[];
  isOwn: boolean;
  // Set when the secondary check failed: the only way out is sending it back, with this prefilled.
  fraudMessage?: string;
}) {
  const [state, action, pending] = useActionState<DecisionState, FormData>(decideAction, { error: null });
  const maxHours = Math.round((claimedSeconds / 3600) * 10) / 10;
  const [hours, setHours] = useState(String(maxHours));
  const [badges, setBadges] = useState<Set<string>>(new Set(claimedBadges));
  const [kind, setKind] = useState<"approve" | "reject">(fraudMessage ? "reject" : "approve");

  const h = Number(hours);
  const bites = Number.isFinite(h) && h > 0 ? bitesFor(Math.min(h, maxHours) * 3600, [...badges]) : 0;
  const cap = capFor([...badges]);

  return (
    <form action={action} className="flex flex-col gap-4 border-t-4 border-rule pt-4">
      <input type="hidden" name="ship_id" value={shipId} />
      <input type="hidden" name="next_id" value={nextId} />
      <input type="hidden" name="kind" value={kind} />

      {isOwn && <Notice>This is your own ship. Only an admin can decide it.</Notice>}

      {fraudMessage ? (
        <p className="text-sm font-medium text-black/60">
          The fraud check failed this one. Read their note above, edit the message if it needs it, and send it back. The author still sees it as in review until you do.
        </p>
      ) : (
        <div className="flex gap-1 text-[0.95rem] font-medium" role="tablist">
          {(["approve", "reject"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={`rounded-[4px] px-3 py-1 ${kind === k ? (k === "approve" ? "bg-accent" : "bg-ink text-white") : "text-black/60 hover:bg-black/5"}`}
            >
              {k === "approve" ? "approve" : "send back"}
            </button>
          ))}
        </div>
      )}

      {kind === "approve" && (
        <>
          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <div>
              <label className="label" htmlFor="hours">
                hours to award · max {maxHours}
              </label>
              <input
                id="hours"
                name="hours"
                type="number"
                step="0.1"
                min="0.1"
                max={maxHours}
                required
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                className="input font-mono"
              />
            </div>
            <div className="text-right">
              <p className="label">they get</p>
              <p className="font-pixel text-[1.8rem] leading-none">{bites} BITES</p>
              <p className="text-xs font-medium text-black/50">
                cap {cap} = {BASE_CAP}
                {cap > BASE_CAP && ` + ${cap - BASE_CAP}`}
              </p>
            </div>
          </div>

          <fieldset>
            <legend className="label">badges earned</legend>
            <ul className="grid grid-cols-2 gap-2">
              {BADGES.map((b) => (
                <li key={b.slug}>
                  <label className="check">
                    <input
                      type="checkbox"
                      name="badge"
                      value={b.slug}
                      checked={badges.has(b.slug)}
                      onChange={() => {
                        const n = new Set(badges);
                        if (n.has(b.slug)) n.delete(b.slug);
                        else n.add(b.slug);
                        setBadges(n);
                      }}
                    />
                    <span className="font-mono text-sm">
                      {b.title} <span className="text-black/50">+{b.bites}</span>
                      {claimedBadges.includes(b.slug) && <span className="ml-1 text-[0.65rem] text-black/40">claimed</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        </>
      )}

      <div>
        <label className="label" htmlFor="message">
          message to the author · they read this
        </label>
        <textarea
          id="message"
          name="message"
          required
          rows={3}
          maxLength={2000}
          className="input"
          defaultValue={fraudMessage}
          placeholder={kind === "approve" ? "Love the procedural beat. Ship more!" : "Runs, but it's a static page: nothing reacts. Add some input and re-ship."}
        />
      </div>

      <div>
        <label className="label" htmlFor="internal_note">
          internal note · never shown to them
        </label>
        <input id="internal_note" name="internal_note" className="input" placeholder="hours look real, timeline is steady" />
      </div>

      {state.error && <Notice>{state.error}</Notice>}

      <div className="flex items-center gap-3">
        <PixelButton type="submit" variant={kind === "approve" ? "light" : "dark"} disabled={pending} className="text-[1rem]">
          {pending ? "…" : kind === "approve" ? `approve · ${bites} BITES` : "send it back"}
        </PixelButton>
        {nextId && <span className="text-sm font-medium text-black/50">then the next one opens</span>}
      </div>
    </form>
  );
}
