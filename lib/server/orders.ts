import "server-only";

import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { REWARD_BY_SLUG } from "@/lib/program";
import { cleanPhone, phoneRequired } from "@/lib/shipping";

import { fetchAddresses, normalizeAddress, type Address } from "./auth/hca";
import { decrypt, encryptJson } from "./crypto";
import { db } from "./db/client";
import { auditEvents, orders, users, type Order, type User } from "./db/schema";
import { orderBinding } from "./effects";
import { staging } from "./env";
import * as ledger from "./ledger";
import { STAGING_ADDRESS } from "./staging";
import { currentEligibility, tokenBinding } from "./users";

export class OrderError extends Error {}

// Asked for and not yet answered. Once denied it stays denied.
export const refundPending = (o: Pick<Order, "state" | "refundRequestedAt" | "refundDeniedAt">) =>
  o.state === "placed" && !!o.refundRequestedAt && !o.refundDeniedAt;

export type AddressChoice = { id: string; address: Address };

export async function addressesFor(user: User): Promise<AddressChoice[] | "reconnect"> {
  if (staging()) return [{ id: "staging", address: STAGING_ADDRESS }];
  if (!user.hcaTokenEncrypted) return "reconnect";
  let token: string;
  try {
    token = decrypt(user.hcaTokenEncrypted, tokenBinding(user.id));
  } catch {
    return "reconnect";
  }
  const raw = await fetchAddresses(token);
  if (raw === "reconnect") return raw;
  const list: AddressChoice[] = [];
  for (const a of raw) {
    const address = normalizeAddress(a, user.displayName);
    if (address) list.push({ id: a.id, address });
  }
  list.sort((x, y) => Number(Boolean(raw.find((r) => r.id === y.id)?.primary)) - Number(Boolean(raw.find((r) => r.id === x.id)?.primary)));
  return list;
}

export async function placeOrder(user: User, input: { rewardSlug: string; addressId: string; phone: string; note: string }): Promise<Order> {
  const reward = REWARD_BY_SLUG.get(input.rewardSlug);
  if (!reward) throw new OrderError("That prize doesn't exist.");
  const note = input.note.trim().slice(0, 500);

  const eligibility = await currentEligibility(user);
  if (eligibility !== "eligible") {
    throw new OrderError(
      eligibility === "blocked_over_18"
        ? "Prizes are for people 18 and under, sorry."
        : "Verify your identity with Hack Club before ordering a prize.",
    );
  }

  let address: Address | null = null;
  if (!reward.digital) {
    const list = await addressesFor(user);
    if (list === "reconnect") throw new OrderError("Sign in again so we can read your address from Hack Club.");
    const chosen = list.find((a) => a.id === input.addressId) ?? list[0];
    if (!chosen) throw new OrderError("Add an address to your Hack Club account first.");
    address = chosen.address;
    // Only asked for when the Hack Club address has none; it goes on this order, not back to Hack Club.
    if (!address.phone) {
      const typed = input.phone.trim();
      const phone = typed ? cleanPhone(typed) : null;
      if (typed && !phone) throw new OrderError("That phone number doesn't look right. Include your country code, like +44 20 7946 0958.");
      if (!phone && phoneRequired(address.country)) throw new OrderError("Add a phone number. Couriers outside the US need one to deliver.");
      address = { ...address, phone };
    }
  }

  return db.transaction(async (tx) => {
    await ledger.lockUser(user.id, tx);
    const bal = await ledger.balance(user.id, tx);
    if (bal < reward.cost) throw new OrderError(`You have ${bal} BITES and this costs ${reward.cost}.`);

    const [order] = await tx
      .insert(orders)
      .values({ userId: user.id, rewardSlug: reward.slug, rewardName: reward.name, cost: reward.cost, note: note || null })
      .returning();
    if (address) {
      await tx
        .update(orders)
        .set({ shippingEncrypted: encryptJson(address, orderBinding(order)) })
        .where(eq(orders.id, order.id));
    }
    await ledger.post(tx, {
      userId: user.id,
      amount: -reward.cost,
      type: "order",
      reason: reward.name,
      idempotencyKey: `order:${order.id}`,
      actorId: user.id,
    });
    return order;
  });
}

export async function handleOrder(
  admin: User,
  orderId: string,
  action: "fulfil" | "reject",
  internalNote: string,
): Promise<Order> {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update").limit(1);
    if (!order) throw new OrderError("No such order.");
    if (order.state !== "placed") throw new OrderError("That order was already handled.");
    if (action === "fulfil" && refundPending(order)) throw new OrderError("They asked for a refund. Approve or deny that first.");

    const [updated] = await tx
      .update(orders)
      .set({
        state: action === "fulfil" ? "fulfilled" : "rejected",
        handledBy: admin.id,
        handledAt: new Date(),
        internalNote: internalNote.trim() || null,
      })
      .where(and(eq(orders.id, order.id), eq(orders.state, "placed")))
      .returning();
    if (!updated) throw new OrderError("That order was already handled.");

    if (action === "reject") {
      await ledger.lockUser(order.userId, tx);
      await ledger.post(tx, {
        userId: order.userId,
        amount: order.cost,
        type: "refund",
        reason: `refund: ${order.rewardName}`,
        idempotencyKey: `order:${order.id}:refund`,
        actorId: admin.id,
      });
    }
    await tx.insert(auditEvents).values({ actorId: admin.id, action: `order.${action}`, subject: order.id });
    return updated;
  });
}

export async function orderFor(userId: string, id: string): Promise<Order | null> {
  const [row] = await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.userId, userId))).limit(1);
  return row ?? null;
}

export async function hasOrders(userId: string): Promise<boolean> {
  const [row] = await db.select({ id: orders.id }).from(orders).where(eq(orders.userId, userId)).limit(1);
  return Boolean(row);
}

export async function ordersOf(userId: string) {
  return db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.createdAt));
}

export async function requestRefund(user: User, orderId: string, reason: string): Promise<Order> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, user.id)))
      .for("update")
      .limit(1);
    if (!order) throw new OrderError("No such order.");
    if (order.state !== "placed") throw new OrderError("This order's already been handled, so it can't be refunded now.");
    if (order.refundDeniedAt) throw new OrderError("We already said no to a refund on this one.");
    if (order.refundRequestedAt) return order;
    const [updated] = await tx
      .update(orders)
      .set({ refundRequestedAt: new Date(), refundReason: reason.trim().slice(0, 500) || null })
      .where(eq(orders.id, order.id))
      .returning();
    await tx.insert(auditEvents).values({ actorId: user.id, action: "order.refund_requested", subject: order.id });
    return updated;
  });
}

// Approving is just cancelling (handleOrder "reject"); this is the no.
export async function denyRefund(admin: User, orderId: string, message: string): Promise<Order> {
  const text = message.trim().slice(0, 500);
  if (!text) throw new OrderError("Tell them why.");
  const [updated] = await db
    .update(orders)
    .set({ refundDeniedAt: new Date(), refundDenial: text })
    .where(and(eq(orders.id, orderId), eq(orders.state, "placed"), isNotNull(orders.refundRequestedAt), isNull(orders.refundDeniedAt)))
    .returning();
  if (!updated) throw new OrderError("There's no open refund request on that order.");
  await db.insert(auditEvents).values({ actorId: admin.id, action: "order.refund_denied", subject: orderId });
  return updated;
}

// Assigning someone else is fine: whoever plans the week hands orders out.
export async function assignOrder(admin: User, orderId: string, assigneeId: string | null): Promise<void> {
  if (assigneeId) {
    const [who] = await db.select({ role: users.role }).from(users).where(eq(users.id, assigneeId)).limit(1);
    if (who?.role !== "admin") throw new OrderError("Only admins can fulfil orders.");
  }
  const [updated] = await db
    .update(orders)
    .set({ assignedTo: assigneeId, assignedAt: assigneeId ? new Date() : null })
    .where(and(eq(orders.id, orderId), eq(orders.state, "placed")))
    .returning({ id: orders.id });
  if (!updated) throw new OrderError("That order was already handled.");
  await db.insert(auditEvents).values({ actorId: admin.id, action: "order.assign", subject: orderId, detail: { to: assigneeId } });
}

export async function admins() {
  return db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.role, "admin")).orderBy(users.displayName);
}

const handlers = alias(users, "handler");
const assignees = alias(users, "assignee");

export async function allOrders() {
  return db
    .select({
      order: orders,
      user: {
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        slackId: users.slackId,
        slackHandle: users.slackHandle,
        avatarUrl: users.avatarUrl,
      },
      handler: handlers.displayName,
      assignee: assignees.displayName,
    })
    .from(orders)
    .innerJoin(users, eq(orders.userId, users.id))
    .leftJoin(handlers, eq(orders.handledBy, handlers.id))
    .leftJoin(assignees, eq(orders.assignedTo, assignees.id))
    .orderBy(desc(orders.createdAt));
}
