import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";

import { H1 } from "@/app/components/ui/bits";
import { requireRole } from "@/lib/server/auth/current";
import { db } from "@/lib/server/db/client";
import { ledgerEntries, orders, ships, users } from "@/lib/server/db/schema";

import AirtableSync from "./AirtableSync";
import People from "./People";
import SlackBackfill from "./SlackBackfill";

// Drizzle leaves columns unqualified in a single-table select, so a correlated
// subquery has to name the outer row itself.
const outerId = sql.raw(`"users"."id"`);

export default async function AdminPage() {
  const admin = await requireRole("admin", "/admin");

  const [people, counts] = await Promise.all([
    db
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        slackId: users.slackId,
        role: users.role,
        eligibility: users.eligibility,
        signedIn: sql<boolean>`${users.hcaSubject} is not null`,
        createdAt: users.createdAt,
        bites: sql<number>`coalesce((select sum(l.amount) from ${ledgerEntries} l where l.user_id = ${outerId}), 0)::int`,
        shipCount: sql<number>`(select count(*) from ${ships} s where s.user_id = ${outerId})::int`,
        hasLink: sql<boolean>`${users.referralCode} is not null`,
        linkRevoked: sql<boolean>`${users.referralRevokedAt} is not null`,
        referred: sql<number>`(select count(*) from ${users} r where r.referred_by_id = ${outerId})::int`,
      })
      .from(users)
      .orderBy(desc(users.createdAt)),
    db
      .select({
        pending: sql<number>`count(*) filter (where ${ships.state} = 'pending')::int`,
        approved: sql<number>`count(*) filter (where ${ships.state} = 'approved')::int`,
        rejected: sql<number>`count(*) filter (where ${ships.state} = 'rejected')::int`,
        bites: sql<number>`coalesce(sum(${ships.awardedBites}), 0)::int`,
      })
      .from(ships),
  ]);
  const [openOrders] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(eq(orders.state, "placed"));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <H1 sub={`${people.length} people · ${counts[0].pending} in queue · ${counts[0].approved} approved · ${counts[0].rejected} sent back · ${counts[0].bites} BITES minted`}>
          admin
        </H1>
        <nav className="mb-[clamp(1.25rem,2vw,32px)] flex gap-1 text-[0.95rem] font-medium">
          <span className="rounded-[4px] bg-accent px-2 py-1">people</span>
          <Link href="/admin/orders" className="rounded-[4px] px-2 py-1 text-black/60 hover:bg-black/5">
            orders {openOrders.n > 0 && <span className="font-pixel">({openOrders.n})</span>}
          </Link>
          <Link href="/admin/audit" className="rounded-[4px] px-2 py-1 text-black/60 hover:bg-black/5">
            audit
          </Link>
          <Link href="/stats" className="rounded-[4px] px-2 py-1 text-black/60 hover:bg-black/5">
            stats
          </Link>
          <AirtableSync />
          <SlackBackfill />
        </nav>
      </div>
      <People people={people.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() }))} selfId={admin.id} />
    </>
  );
}
