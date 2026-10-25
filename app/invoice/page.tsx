import type { Metadata } from "next";

import { reviewerMonths, reviewerPeriod } from "@/lib/server/audit";
import { requireRole } from "@/lib/server/auth/current";
import { env } from "@/lib/server/env";
import { addressesFor } from "@/lib/server/orders";
import { dayStart, localDay } from "@/lib/tz";

import Invoice from "./Invoice";

export const metadata: Metadata = { title: "Reviewer invoice — SHRINK" };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

// Kept out of /review on purpose: everything under it is screen-recorded, and this
// page has the reviewer's address and bank details on it.
export default async function InvoicePage({ searchParams }: PageProps<"/invoice">) {
  const reviewer = await requireRole("reviewer", "/invoice");
  const { month: asked } = await searchParams;
  const months = await reviewerMonths(reviewer.id);
  const today = localDay(new Date());
  const month = typeof asked === "string" && MONTH.test(asked) ? asked : (months[0] ?? today.slice(0, 7));

  const [work, addresses] = await Promise.all([
    reviewerPeriod(reviewer.id, dayStart(`${month}-01`), dayStart(`${nextMonth(month)}-01`)),
    addressesFor(reviewer).catch(() => "reconnect" as const),
  ]);
  const a = addresses === "reconnect" ? null : (addresses[0]?.address ?? null);
  const address = a ? [a.line1, a.line2, [a.city, a.region, a.postcode].filter(Boolean).join(", "), a.country].filter(Boolean).join("\n") : "";

  return (
    <Invoice
      key={month}
      month={month}
      months={months.includes(month) ? months : [month, ...months]}
      issued={today}
      work={{
        hours: Math.round(work.ms / 36_000) / 100,
        decisions: work.decisions,
      }}
      rate={env.REVIEWER_HOURLY_RATE}
      defaults={{ name: reviewer.displayName, email: reviewer.email, manager: env.REVIEWER_MANAGER, address }}
    />
  );
}
