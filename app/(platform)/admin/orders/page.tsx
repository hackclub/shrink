import Link from "next/link";

import { H1 } from "@/app/components/ui/bits";
import { REWARD_BY_SLUG } from "@/lib/program";
import { requireRole } from "@/lib/server/auth/current";
import { allOrders } from "@/lib/server/orders";

import OrdersTable from "./OrdersTable";

export default async function AdminOrdersPage() {
  await requireRole("admin", "/admin/orders");
  const rows = await allOrders();
  const open = rows.filter((r) => r.order.state === "placed").length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <H1 sub={`${open} to fulfil · ${rows.length} total. Addresses are revealed one at a time and every reveal is logged.`}>orders</H1>
        <nav className="mb-[clamp(1.25rem,2vw,32px)] flex gap-1 text-[0.95rem] font-medium">
          <Link href="/admin" className="rounded-[4px] px-2 py-1 text-black/60 hover:bg-black/5">
            people
          </Link>
          <span className="rounded-[4px] bg-accent px-2 py-1">orders</span>
          <Link href="/admin/audit" className="rounded-[4px] px-2 py-1 text-black/60 hover:bg-black/5">
            audit
          </Link>
        </nav>
      </div>
      <OrdersTable
        rows={rows.map((r) => ({
          id: r.order.id,
          number: r.order.number,
          reward: r.order.rewardName,
          digital: Boolean(REWARD_BY_SLUG.get(r.order.rewardSlug)?.digital),
          cost: r.order.cost,
          state: r.order.state,
          note: r.order.note,
          internalNote: r.order.internalNote,
          createdAt: r.order.createdAt.toISOString(),
          user: r.user,
        }))}
      />
    </>
  );
}
