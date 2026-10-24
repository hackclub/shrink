import Link from "next/link";
import { redirect } from "next/navigation";

import { H1, PixelLink, when } from "@/app/components/ui/bits";
import { requireUser } from "@/lib/server/auth/current";
import { ordersOf, refundPending } from "@/lib/server/orders";

const LABEL = { placed: "placed", fulfilled: "on its way", rejected: "cancelled · refunded" } as const;
const PILL = { placed: "pill-pending", fulfilled: "pill-approved", rejected: "pill-rejected" } as const;

export default async function OrdersPage() {
  const user = await requireUser("/app/orders");
  const orders = await ordersOf(user.id);
  if (orders.length === 0) redirect("/app/shop");

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <H1>your orders</H1>
        <PixelLink href="/app/shop" className="mb-[clamp(1.25rem,2vw,32px)]">
          shop →
        </PixelLink>
      </div>
      <ul className="flex flex-col gap-3">
        {orders.map((o) => (
          <li key={o.id}>
            <Link href={`/app/orders/${o.id}`} className="card flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-transform hover:-translate-y-0.5">
              <div>
                <p className="font-semibold tracking-tight">{o.rewardName}</p>
                <p className="font-mono text-xs text-black/50">
                  #{o.number} · {o.cost} BITES · {when(o.createdAt)}
                  {o.note && ` · "${o.note}"`}
                </p>
              </div>
              <span className={`pill ${PILL[o.state]}`}>{refundPending(o) ? "refund requested" : LABEL[o.state]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
