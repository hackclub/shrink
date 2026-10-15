"use client";

import { useActionState, useState } from "react";

import PixelButton from "@/app/components/PixelButton";
import { Notice } from "@/app/components/ui/bits";

import { adjustAction, referralLinkAction, setRoleAction, type AdminState } from "./actions";

type Person = {
  id: string;
  displayName: string;
  email: string;
  slackId: string | null;
  role: "participant" | "reviewer" | "admin";
  eligibility: string;
  signedIn: boolean;
  createdAt: string;
  bites: number;
  shipCount: number;
  hasLink: boolean;
  linkRevoked: boolean;
  referred: number;
};

export default function People({ people, selfId }: { people: Person[]; selfId: string }) {
  const [q, setQ] = useState("");
  const [roleState, roleAction] = useActionState<AdminState, FormData>(setRoleAction, { error: null });
  const [linkState, linkAction] = useActionState<AdminState, FormData>(referralLinkAction, { error: null });
  const [adjState, adjAction, adjPending] = useActionState<AdminState, FormData>(adjustAction, { error: null });
  const [adjusting, setAdjusting] = useState<{ person: Person; nonce: string } | null>(null);

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? people.filter((p) => [p.displayName, p.email, p.slackId ?? ""].some((s) => s.toLowerCase().includes(needle)))
    : people;

  return (
    <div className="flex flex-col gap-4">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search name, email, slack id" className="input max-w-md font-mono text-sm" />
      {(roleState.error || roleState.ok) && <Notice kind={roleState.error ? "error" : "ok"}>{roleState.error ?? roleState.ok}</Notice>}
      {(linkState.error || linkState.ok) && <Notice kind={linkState.error ? "error" : "ok"}>{linkState.error ?? linkState.ok}</Notice>}

      <div className="card overflow-x-auto bg-white">
        <table className="w-full text-sm">
          <thead className="text-sm font-medium text-black/50">
            <tr className="border-b-2 border-panel-border text-left">
              <th className="px-3 py-2 font-normal">person</th>
              <th className="px-3 py-2 font-normal">eligibility</th>
              <th className="px-3 py-2 text-right font-normal">ships</th>
              <th className="px-3 py-2 text-right font-normal">BITES</th>
              <th className="px-3 py-2 text-right font-normal">invited</th>
              <th className="px-3 py-2 font-normal">role</th>
              <th className="px-3 py-2 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className="border-b border-panel-border/60 last:border-0">
                <td className="px-3 py-2">
                  <span className="block font-semibold tracking-tight">{p.displayName}</span>
                  <span className="block font-mono text-xs text-black/50">
                    {[p.email, p.slackId].filter(Boolean).join(" · ")}
                  </span>
                </td>
                {p.signedIn ? (
                  <td className={`px-3 py-2 font-mono text-xs ${p.eligibility === "eligible" ? "text-black/60" : "text-[#c1121f]"}`}>{p.eligibility.replace(/_/g, " ")}</td>
                ) : (
                  <td className="px-3 py-2 font-mono text-xs text-black/40">joined on slack, not signed in</td>
                )}
                <td className="px-3 py-2 text-right font-mono">{p.shipCount}</td>
                <td className="px-3 py-2 text-right font-pixel">{p.bites}</td>
                <td className="px-3 py-2 text-right">
                  {p.hasLink || p.linkRevoked ? (
                    <form action={linkAction} className="flex items-center justify-end gap-2">
                      <input type="hidden" name="user_id" value={p.id} />
                      <input type="hidden" name="revoke" value={p.linkRevoked ? "0" : "1"} />
                      <span className={`font-mono ${p.linkRevoked ? "text-[#c1121f] line-through" : ""}`}>{p.referred}</span>
                      <button
                        type="submit"
                        className="text-xs font-medium underline decoration-1 underline-offset-[0.2em] hover:decoration-2"
                        title={p.linkRevoked ? "Turn their invite link back on" : "Turn off their invite link for spamming"}
                      >
                        {p.linkRevoked ? "restore" : "pull link"}
                      </button>
                    </form>
                  ) : (
                    <span className="font-mono text-xs text-black/30">no link</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {p.id === selfId ? (
                    <span className="font-mono text-xs">{p.role} (you)</span>
                  ) : (
                    <form action={roleAction} className="flex items-center gap-1">
                      <input type="hidden" name="user_id" value={p.id} />
                      <select name="role" defaultValue={p.role} className="input w-auto py-1 font-mono text-xs">
                        <option value="participant">participant</option>
                        <option value="reviewer">reviewer</option>
                        <option value="admin">admin</option>
                      </select>
                      <button type="submit" className="text-sm font-medium underline decoration-1 underline-offset-[0.2em] hover:decoration-2">
                        set
                      </button>
                    </form>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setAdjusting({ person: p, nonce: crypto.randomUUID() })}
                    className="text-sm font-medium underline decoration-1 underline-offset-[0.2em] hover:decoration-2"
                  >
                    ± BITES
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adjusting && (
        <div className="flex flex-col gap-3 border-t-4 border-rule pt-4">
          <p className="font-semibold tracking-tight">
            Adjust BITES for {adjusting.person.displayName} <span className="font-mono text-xs text-black/50">({adjusting.person.bites} now)</span>
          </p>
          <form
            action={(fd) => {
              adjAction(fd);
              setAdjusting(null);
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="user_id" value={adjusting.person.id} />
            <input type="hidden" name="nonce" value={adjusting.nonce} />
            <div>
              <label className="label" htmlFor="amount">
                amount (negative to take back)
              </label>
              <input id="amount" name="amount" type="number" step="1" min={-50} max={50} required className="input w-32 font-mono" />
            </div>
            <div className="min-w-[240px] flex-1">
              <label className="label" htmlFor="reason">
                reason · goes in the ledger
              </label>
              <input id="reason" name="reason" required maxLength={200} className="input" placeholder="sticker sheet bonus / manual fix" />
            </div>
            <PixelButton type="submit" variant="dark" disabled={adjPending}>
              post
            </PixelButton>
            <PixelButton type="button" onClick={() => setAdjusting(null)}>
              cancel
            </PixelButton>
          </form>
        </div>
      )}
      {(adjState.error || adjState.ok) && <Notice kind={adjState.error ? "error" : "ok"}>{adjState.error ?? adjState.ok}</Notice>}
    </div>
  );
}
