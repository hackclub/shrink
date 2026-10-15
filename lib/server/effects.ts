import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";

import { hm } from "@/lib/program";

import { decryptJson } from "./crypto";
import { db } from "./db/client";
import { ledgerEntries, orders, ships, users, type Order, type Ship, type User } from "./db/schema";
import { env } from "./env";
import { referralKey } from "./referrals";
import type { Address } from "./auth/hca";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function slack(method: string, body: Record<string, unknown>, fine: string[] = []): Promise<void> {
  if (!env.SLACK_BOT_TOKEN) return;
  try {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if ((!res.ok || !json.ok) && !fine.includes(json.error ?? "")) console.error(`[slack] ${method} failed: ${json.error ?? res.status}`);
  } catch (e) {
    console.error(`[slack] ${method} threw`, e);
  }
}

async function channel(text: string) {
  if (!env.SLACK_CHANNEL_ID) return;
  await slack("chat.postMessage", { channel: env.SLACK_CHANNEL_ID, text, unfurl_links: false, unfurl_media: false });
}

// `text` is the notification preview; `blocks`, if given, is what shows in the DM.
async function dm(user: Pick<User, "slackId">, text: string, blocks?: unknown[]) {
  if (!env.SLACK_DMS || !user.slackId) return;
  await slack("chat.postMessage", { channel: user.slackId, text, blocks, unfurl_links: false, unfurl_media: false });
}

const section = (text: string) => ({ type: "section", text: { type: "mrkdwn", text } });

const who = (u: Pick<User, "displayName" | "slackId">) => (u.slackId ? `<@${u.slackId}>` : esc(u.displayName));

// Admin ships are tests of the flow, so they stay out of the channel (DMs still go).
const test = (author: User) => author.role === "admin";

export async function shipShipped(ship: Ship, author: User, origin: string) {
  if (test(author)) return;
  await channel(
    `${who(author)} shipped *${esc(ship.title)}* (${ship.bytes}b, ${hm(ship.claimedSeconds)} logged). <${origin}/review?s=${ship.id}|review it>`,
  );
}

export async function shipUnshipped(ship: Ship, author: User) {
  if (test(author)) return;
  await channel(`${who(author)} unshipped *${esc(ship.title)}*, so it's out of the queue.`);
}

export async function shipDecided(ship: Ship, author: User, origin: string) {
  const link = `<${origin}/app/ships/${ship.id}|${esc(ship.title)}>`;
  const quote = ship.publicMessage ? `\n> ${esc(ship.publicMessage).replace(/\n/g, "\n> ")}` : "";
  if (ship.state === "approved") {
    await Promise.all([
      !test(author) && channel(`${who(author)}'s ${link} was approved: ${ship.awardedBites} BITES.`),
      dm(
        author,
        ship.awardedBites
          ? `your ship *${esc(ship.title)}* was approved for *${ship.awardedBites} BITES*! 🎉${quote}`
          : `your ship *${esc(ship.title)}* was approved, but for *0 BITES* since it's under an hour. BITES are 1 per hour, rounded down (.9 rounds up). keep building!${quote}`,
      ),
    ]);
    await referralPaid(author, ship, origin);
  } else if (ship.state === "rejected") {
    // A failed fraud check can't be fixed by resubmitting, so it gets no button.
    const fraud = ship.secondaryState === "failed";
    const text = fraud
      ? `your ship *${esc(ship.title)}* was sent back.${quote}`
      : `your ship *${esc(ship.title)}* is almost there! it just needs a quick fix before it can be approved. here's what the reviewer said:${quote}`;
    await Promise.all([
      !test(author) && channel(`${who(author)}'s ${link} was sent back.`),
      fraud
        ? dm(author, text)
        : dm(author, text, [
            section(text),
            section("everything you submitted is saved, so just fix that one thing and hit resubmit. it goes straight back into review and you'll be prioritised."),
            {
              type: "actions",
              elements: [
                { type: "button", style: "primary", text: { type: "plain_text", text: "resubmit" }, url: `${origin}/app/ship?from=${ship.id}` },
              ],
            },
          ]),
    ]);
  }
}

// Only tells the referrer if this approval is the one that paid them.
async function referralPaid(author: User, ship: Ship, origin: string) {
  if (!author.referredById) return;
  const [row] = await db
    .select({ amount: ledgerEntries.amount, at: ledgerEntries.createdAt, referrer: users })
    .from(ledgerEntries)
    .innerJoin(users, eq(ledgerEntries.userId, users.id))
    .where(eq(ledgerEntries.idempotencyKey, referralKey(author.id)))
    .limit(1);
  if (!row || !ship.reviewedAt || Math.abs(row.at.getTime() - ship.reviewedAt.getTime()) > 60_000) return;
  await dm(
    row.referrer,
    `${who(author)} signed up with your link and just got *${esc(ship.title)}* approved, so you get *${row.amount} BITE${row.amount === 1 ? "" : "S"}*. thanks for bringing them in!\n${origin}/app/invite`,
  );
}

export async function orderPlaced(order: Order, user: User, origin: string) {
  await channel(`${who(user)} ordered *${esc(order.rewardName)}* for ${order.cost} BITES. <${origin}/admin/orders|orders>`);
}

export async function orderHandled(order: Order, user: User) {
  const text =
    order.state === "fulfilled"
      ? `your *${esc(order.rewardName)}* is on its way!`
      : `your order for *${esc(order.rewardName)}* was cancelled and your ${order.cost} BITES are back.${
          order.internalNote ? `\n> ${esc(order.internalNote)}` : ""
        }`;
  await dm(user, text);
}


// Needs channels:write.invites, and the bot has to be in the channel itself.
export async function joinedProgram(user: Pick<User, "slackId">) {
  if (!env.SLACK_PROGRAM_CHANNEL_ID || !user.slackId) return;
  await slack("conversations.invite", { channel: env.SLACK_PROGRAM_CHANNEL_ID, users: user.slackId }, ["already_in_channel"]);
}

// Invites everyone who signed in and finished onboarding, for anyone the live
// invite missed. `force` keeps a batch going past people already in the channel.
export async function backfillProgramChannel(): Promise<{ invited: number; already: number; failed: number } | { error: string }> {
  if (!env.SLACK_BOT_TOKEN || !env.SLACK_PROGRAM_CHANNEL_ID) return { error: "Set SLACK_BOT_TOKEN first." };
  const rows = await db
    .selectDistinct({ slackId: users.slackId })
    .from(users)
    .where(and(isNotNull(users.hcaSubject), isNotNull(users.onboardedAt), isNotNull(users.slackId)));
  const ids = rows.map((r) => r.slackId!);
  const n = { invited: 0, already: 0, failed: 0 };
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const res = await fetch("https://slack.com/api/conversations.invite", {
      method: "POST",
      headers: { authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: env.SLACK_PROGRAM_CHANNEL_ID, users: batch.join(","), force: true }),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string; errors?: { user: string; error: string }[] };
    const errors = json.errors ?? [];
    if (!json.ok && !errors.length) return { error: `Slack said ${json.error ?? res.status}.` };
    const already = errors.filter((e) => e.error === "already_in_channel").length;
    for (const e of errors) if (e.error !== "already_in_channel") console.error(`[slack] backfill ${e.user}: ${e.error}`);
    n.invited += batch.length - errors.length;
    n.already += already;
    n.failed += errors.length - already;
  }
  return n;
}

export async function loadShipAndAuthor(shipId: string) {
  const [row] = await db
    .select({ ship: ships, author: users })
    .from(ships)
    .innerJoin(users, eq(ships.userId, users.id))
    .where(eq(ships.id, shipId))
    .limit(1);
  return row ?? null;
}

export async function loadOrderAndUser(orderId: string) {
  const [row] = await db
    .select({ order: orders, user: users })
    .from(orders)
    .innerJoin(users, eq(orders.userId, users.id))
    .where(eq(orders.id, orderId))
    .limit(1);
  return row ?? null;
}

export const orderBinding = (order: Pick<Order, "id" | "userId">) => `orders/${order.userId}/${order.id}/shipping`;

export function readAddress(order: Order): Address | null {
  if (!order.shippingEncrypted) return null;
  return decryptJson<Address>(order.shippingEncrypted, orderBinding(order));
}
