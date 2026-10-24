import { REWARD_BY_SLUG } from "@/lib/program";
import { requireRole } from "@/lib/server/auth/current";
import { admins, allOrders } from "@/lib/server/orders";

import OrdersDesk from "./OrdersDesk";

// Taken once per render so the server and the browser agree on how long things have waited.
const renderedAt = () => Date.now();

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ o?: string }> }) {
  const me = await requireRole("admin", "/admin/orders");
  const [rows, team, { o }] = await Promise.all([allOrders(), admins(), searchParams]);

  return (
    <OrdersDesk
      now={renderedAt()}
      initial={o ?? null}
      me={me.id}
      team={team}
      rows={rows.map((r) => {
        const reward = REWARD_BY_SLUG.get(r.order.rewardSlug);
        return {
          id: r.order.id,
          number: r.order.number,
          rewardSlug: r.order.rewardSlug,
          reward: r.order.rewardName,
          img: reward?.img ? { src: `/design/rewards/${reward.img}.png`, w: reward.w ?? 200, h: reward.h ?? 200 } : null,
          digital: Boolean(reward?.digital),
          cost: r.order.cost,
          state: r.order.state,
          note: r.order.note,
          internalNote: r.order.internalNote,
          createdAt: r.order.createdAt.toISOString(),
          handledAt: r.order.handledAt?.toISOString() ?? null,
          refundRequestedAt: r.order.refundRequestedAt?.toISOString() ?? null,
          refundReason: r.order.refundReason,
          refundDenial: r.order.refundDeniedAt ? (r.order.refundDenial ?? "") : null,
          handler: r.handler,
          assignee: r.order.assignedTo && r.assignee ? { id: r.order.assignedTo, name: r.assignee } : null,
          user: r.user,
        };
      })}
    />
  );
}
