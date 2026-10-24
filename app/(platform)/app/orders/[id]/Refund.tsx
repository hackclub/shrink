"use client";

import { useActionState, useState } from "react";

import PixelButton from "@/app/components/PixelButton";
import { Notice } from "@/app/components/ui/bits";

import { refundRequestAction, type RefundState } from "./actions";

// Asking is all the person does: the order stays as is until an admin says yes (cancelled,
// BITES back) or no (it ships as normal). Only shown while the order hasn't been handled.
export default function Refund({
  orderId,
  cost,
  requestedAt,
  denial,
}: {
  orderId: string;
  cost: number;
  requestedAt: string | null;
  denial: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<RefundState, FormData>(refundRequestAction, { error: null });

  if (denial !== null) {
    return (
      <div className="card flex max-w-[52ch] flex-col gap-2 bg-white px-5 py-4">
        <p className="font-semibold tracking-tight">refund declined</p>
        <p className="text-sm font-medium text-black/70">We couldn&apos;t cancel this one, so it&apos;s still coming.</p>
        {denial && <p className="border-l-4 border-panel-border pl-3 text-sm font-medium">{denial}</p>}
      </div>
    );
  }

  if (requestedAt) {
    return (
      <div className="card flex max-w-[52ch] flex-col gap-1 bg-white px-5 py-4">
        <p className="font-semibold tracking-tight">refund requested</p>
        <p className="text-sm font-medium text-black/70">
          Someone on the team will look at it soon. If they say yes, your {cost} BITES come back. You&apos;ll get a Slack DM either way.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-sm font-medium text-black/60 underline decoration-1 underline-offset-[0.25em] hover:text-black hover:decoration-2"
      >
        changed your mind? request a refund
      </button>
    );
  }

  return (
    <form action={action} className="card flex max-w-[52ch] flex-col gap-3 bg-white px-5 py-4">
      <input type="hidden" name="order_id" value={orderId} />
      <div>
        <p className="font-semibold tracking-tight">request a refund</p>
        <p className="mt-1 text-sm font-medium text-black/70">
          If the team approves it, we cancel the order and give back your {cost} BITES. If it&apos;s already on its way, we might have to say no.
        </p>
      </div>
      <div>
        <label className="label" htmlFor="reason">
          why? (optional)
        </label>
        <textarea id="reason" name="reason" rows={2} maxLength={500} className="input text-sm" placeholder="want to save up for something else" />
      </div>
      {state.error && <Notice>{state.error}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <PixelButton type="submit" variant="dark" disabled={pending}>
          {pending ? "sending…" : "request refund"}
        </PixelButton>
        <button type="button" onClick={() => setOpen(false)} className="text-sm font-medium underline decoration-1 underline-offset-[0.25em] hover:decoration-2">
          never mind
        </button>
      </div>
    </form>
  );
}
