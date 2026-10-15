"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";

import PixelButton from "@/app/components/PixelButton";
import { Notice } from "@/app/components/ui/bits";
import { phoneRequired } from "@/lib/shipping";

import { orderAction, type OrderFormState } from "./actions";

type RewardView = { slug: string; name: string; desc: string; img: string | null; w: number; h: number; cost: number; digital: boolean; tilt: number };
type AddressView = { id: string; recipient: string; line1: string; line2: string | null; city: string; region: string | null; postcode: string; country: string; phone: string | null };

export default function Shop({
  rewards,
  bites,
  eligibility,
  addresses,
  hcaAddressesUrl,
  hcaVerifyUrl,
}: {
  rewards: RewardView[];
  bites: number;
  eligibility: string;
  addresses: AddressView[] | null;
  hcaAddressesUrl: string;
  hcaVerifyUrl: string;
}) {
  const [open, setOpen] = useState<RewardView | null>(null);
  const eligible = eligibility === "eligible";

  return (
    <>
      {!eligible && (
        <div className="mb-6">
          <Notice>
            {eligibility === "blocked_over_18" ? (
              "Prizes are only for people 18 and under."
            ) : (
              <>
                Prizes need a verified Hack Club account.{" "}
                <a href={hcaVerifyUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  Verify here
                </a>
                , then sign in again.
              </>
            )}
          </Notice>
        </div>
      )}

      <section className="relative -mx-[var(--gutter)] overflow-hidden border-y-4 border-rule">
        <div className="diag-stripes absolute inset-0" aria-hidden />
        <ul className="relative grid grid-cols-2 gap-x-[clamp(8px,1vw,20px)] gap-y-[clamp(20px,2.4vw,44px)] px-[var(--gutter)] py-[clamp(1.5rem,3vw,56px)] sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {rewards.map((r) => {
            const can = eligible && bites >= r.cost;
            return (
              <li key={r.slug} className="flex">
                <button
                  type="button"
                  disabled={!can}
                  onClick={() => setOpen(r)}
                  title={can ? `${r.name} · ${r.desc}` : eligible ? `Costs ${r.cost} BITES, you have ${bites}.` : r.name}
                  className="shop-item flex w-full cursor-pointer flex-col items-center gap-2 rounded-[10px] px-2 pt-3 pb-3 text-center disabled:cursor-not-allowed"
                  style={{ "--tilt": `${r.tilt}deg` } as React.CSSProperties}
                >
                  <div className="shop-sticker reward-sticker flex h-[clamp(88px,9vw,132px)] w-full items-center justify-center">
                    {r.img ? (
                      <Image
                        src={`/design/rewards/${r.img}.png`}
                        alt=""
                        width={r.w}
                        height={r.h}
                        sizes="(min-width: 1280px) 12vw, (min-width: 640px) 22vw, 40vw"
                        className="max-h-full w-auto max-w-[78%]"
                        draggable={false}
                      />
                    ) : (
                      <div className="reward-placeholder flex aspect-[4/3] h-full items-center justify-center font-pixel text-xs text-black/40">art soon</div>
                    )}
                  </div>
                  <p className="reward-label font-pixel text-[clamp(0.95rem,1.15vw,1.25rem)] font-semibold leading-[0.95] text-black">{r.name}</p>
                  <span className="rounded-[0.2em] bg-black px-[0.5em] py-[0.25em] font-mono text-xs font-medium leading-none text-white">
                    {r.cost} BITES
                  </span>
                  {eligible && !can && <span className="font-mono text-xs font-medium text-black/50">{r.cost - bites} more to go</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {open && (
        <OrderDialog
          reward={open}
          bites={bites}
          addresses={addresses}
          hcaAddressesUrl={hcaAddressesUrl}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function OrderDialog({
  reward,
  bites,
  addresses,
  hcaAddressesUrl,
  onClose,
}: {
  reward: RewardView;
  bites: number;
  addresses: AddressView[] | null;
  hcaAddressesUrl: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [state, action, pending] = useActionState<OrderFormState, FormData>(orderAction, { error: null });
  const [refreshing, startRefresh] = useTransition();
  // Controlled, so what they typed survives an error (a form action resets uncontrolled fields).
  const [addressId, setAddressId] = useState(addresses?.[0]?.id ?? "");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const needsAddress = !reward.digital;
  const noAddress = needsAddress && (!addresses || addresses.length === 0);
  const chosen = addresses?.find((a) => a.id === addressId) ?? addresses?.[0] ?? null;
  const askPhone = needsAddress && chosen !== null && !chosen.phone;
  const mustPhone = askPhone && phoneRequired(chosen.country);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-auto max-h-[90svh] w-[min(92vw,560px)] overflow-y-auto border-[3px] border-black bg-white p-0 text-black outline outline-[3px] outline-white backdrop:bg-black/70"
    >
      <form action={action}>
        <input type="hidden" name="reward" value={reward.slug} />
        <div className="flex items-center justify-between gap-4 border-b-[3px] border-black px-5 py-3">
          <p className="font-pixel text-lg sm:text-2xl">get {reward.name}</p>
          <PixelButton variant="dark" className="text-sm" onClick={onClose}>
            close
          </PixelButton>
        </div>

        <div className="flex flex-col gap-5 px-5 py-5">
          <div className="flex items-center gap-4">
            {reward.img && (
              <div className="reward-sticker flex h-20 w-24 shrink-0 items-center justify-center">
                <Image src={`/design/rewards/${reward.img}.png`} alt="" width={reward.w} height={reward.h} className="max-h-full w-auto max-w-full" />
              </div>
            )}
            <p className="font-medium text-black/80">{reward.desc}</p>
          </div>

          <div className="flex items-baseline justify-between border-y-4 border-rule py-3 font-mono text-sm">
            <span>
              {bites} BITES − {reward.cost}
            </span>
            <span className="font-pixel text-[1.3rem] leading-none">= {bites - reward.cost} left</span>
          </div>

          {needsAddress && (
            <fieldset>
              <legend className="label">ship to</legend>
              {noAddress ? (
                <div className="flex flex-col gap-3">
                  <Notice>
                    {addresses === null
                      ? "We couldn't read your address from Hack Club. Sign out and in again, and make sure you have one on your Hack Club account."
                      : "No address on your Hack Club account yet."}
                  </Notice>
                  <div className="flex flex-wrap items-center gap-3">
                    <a href={hcaAddressesUrl} target="_blank" rel="noreferrer" className="font-semibold underline decoration-1 underline-offset-[0.25em] hover:decoration-2">
                      add an address ↗
                    </a>
                    <PixelButton onClick={() => startRefresh(() => router.refresh())} disabled={refreshing} className="text-sm">
                      {refreshing ? "checking…" : "i added one"}
                    </PixelButton>
                  </div>
                </div>
              ) : (
                <>
                  <ul className="flex flex-col gap-2">
                    {addresses!.map((a) => (
                      <li key={a.id}>
                        <label className="check">
                          <input type="radio" name="address" value={a.id} checked={chosen?.id === a.id} onChange={() => setAddressId(a.id)} required />
                          <span className="text-sm leading-snug">
                            <span className="block font-semibold">{a.recipient}</span>
                            {a.line1}
                            {a.line2 ? `, ${a.line2}` : ""}, {a.city}
                            {a.region ? `, ${a.region}` : ""} {a.postcode}, {a.country}
                            <span className="block font-mono text-xs text-black/50">{a.phone ?? "no phone number"}</span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-sm font-medium text-black/50">
                    Wrong?{" "}
                    <a href={hcaAddressesUrl} target="_blank" rel="noreferrer" className="underline">
                      Change it on auth.hackclub.com
                    </a>
                    , then{" "}
                    <button type="button" onClick={() => startRefresh(() => router.refresh())} className="underline">
                      {refreshing ? "reloading…" : "reload it here"}
                    </button>
                    .
                  </p>
                </>
              )}
            </fieldset>
          )}

          {askPhone && (
            <div>
              <label className="label" htmlFor="phone">
                phone number{mustPhone ? " · the courier needs one to deliver outside the US" : " · optional, helps the courier"}
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                maxLength={30}
                required={mustPhone}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={mustPhone ? "+44 20 7946 0958" : "+1 555 010 0199"}
                className="input font-mono"
              />
              <p className="mt-1 text-xs font-medium text-black/50">Include your country code. Only used for this order&rsquo;s delivery.</p>
            </div>
          )}

          <div>
            <label className="label" htmlFor="note">
              anything we should know?
            </label>
            <input id="note" name="note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className="input" />
          </div>

          {state.error && <Notice>{state.error}</Notice>}

          <div className="flex flex-wrap items-center gap-3">
            <PixelButton type="submit" variant="dark" disabled={pending || noAddress} className="text-[1rem]">
              {pending ? "ordering…" : `spend ${reward.cost} BITES`}
            </PixelButton>
            {!reward.digital && chosen && !noAddress && (
              <span className="text-sm font-medium text-black/50">
                ships to {chosen.city}, {chosen.country}
              </span>
            )}
          </div>
        </div>
      </form>
    </dialog>
  );
}
