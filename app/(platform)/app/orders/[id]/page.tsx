import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import Barcode from "@/app/components/Barcode";
import { H1, when } from "@/app/components/ui/bits";
import { REWARD_BY_SLUG } from "@/lib/program";
import { requireUser } from "@/lib/server/auth/current";
import { balance } from "@/lib/server/ledger";
import { readAddress } from "@/lib/server/effects";
import { orderFor } from "@/lib/server/orders";

import Placed from "./Placed";

const LABEL = { placed: "placed", fulfilled: "on its way", rejected: "cancelled · refunded" } as const;
const PILL = { placed: "pill-pending", fulfilled: "pill-approved", rejected: "pill-rejected" } as const;

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ placed?: string }>;
}) {
  const { id } = await params;
  const user = await requireUser(`/app/orders/${id}`);
  const [order, { placed }, bites] = await Promise.all([orderFor(user.id, id), searchParams, balance(user.id)]);
  if (!order) notFound();

  const reward = REWARD_BY_SLUG.get(order.rewardSlug);
  const address = (() => {
    try {
      return readAddress(order);
    } catch {
      return null;
    }
  })();

  const row = (name: string, value: React.ReactNode) => (
    <div className="py-3">
      <dt className="text-xs font-semibold text-black/50">{name}</dt>
      <dd className="mt-1">{value}</dd>
    </div>
  );

  return (
    <>
      {placed && <Placed />}
      <H1>{placed ? "order placed" : `order #${order.number}`}</H1>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-[14px] border-2 border-black bg-white">
          <div className="hazard-thin" aria-hidden />
          <div className="flex items-start justify-between px-5 pt-4">
            <span className="wordmark text-[1.9rem] leading-none tracking-tight">SHRINK</span>
            <span className={`pill ${PILL[order.state]}`}>{LABEL[order.state]}</span>
          </div>

          <div className="reward-sticker flex h-40 items-center justify-center px-5 pt-4">
            {reward?.img ? (
              <Image
                src={`/design/rewards/${reward.img}.png`}
                alt=""
                width={reward.w ?? 200}
                height={reward.h ?? 200}
                className="max-h-full w-auto max-w-[70%] -rotate-3"
              />
            ) : (
              <div className="reward-placeholder flex aspect-[4/3] h-full items-center justify-center font-pixel text-xs text-black/40">art soon</div>
            )}
          </div>

          <dl className="mt-2 divide-y-2 divide-dashed divide-panel-border px-5">
            {row("item", <p className="text-[1.15rem] font-semibold leading-tight tracking-tight">{order.rewardName}</p>)}
            {row(
              "ship to",
              address ? (
                <p className="text-sm font-medium leading-snug">
                  {address.recipient}
                  <br />
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ""}
                  <br />
                  {[address.city, address.region, address.postcode].filter(Boolean).join(", ")}, {address.country}
                  {address.phone && (
                    <>
                      <br />
                      <span className="font-mono text-xs">{address.phone}</span>
                    </>
                  )}
                </p>
              ) : (
                <p className="text-sm font-medium text-black/50">{reward?.digital ? "digital, nothing to ship" : "—"}</p>
              ),
            )}
            {order.note && row("note", <p className="text-sm font-medium">{order.note}</p>)}
            {row("placed", <p className="font-mono text-sm">{when(order.createdAt)}</p>)}
          </dl>

          <div className="mt-1 flex items-end justify-between gap-3 border-t-2 border-black px-5 py-4">
            <span className="font-mono text-xs text-black/50">#{order.number}</span>
            <span className="font-pixel text-[2.2rem] leading-none">−{order.cost} BITES</span>
          </div>
          <Barcode value={`${order.id}:${order.number}:${order.rewardSlug}`} />
        </div>

        <div className="flex flex-col gap-3">
          <p className="font-medium text-black/70">
            <span className="font-pixel text-black">{bites} BITES</span> left.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/app/shop" className="font-semibold underline decoration-1 underline-offset-[0.25em] hover:decoration-2">
              back to the shop
            </Link>
            <Link href="/app/orders" className="font-semibold underline decoration-1 underline-offset-[0.25em] hover:decoration-2">
              all orders
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
