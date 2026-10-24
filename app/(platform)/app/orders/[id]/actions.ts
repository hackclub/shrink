"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { queueSync } from "@/lib/server/airtable";
import { actionUser } from "@/lib/server/auth/current";
import { loadOrderAndUser, refundRequested } from "@/lib/server/effects";
import { OrderError, requestRefund } from "@/lib/server/orders";
import { requestOrigin } from "@/lib/server/origin";

export type RefundState = { error: string | null };

export async function refundRequestAction(_prev: RefundState, form: FormData): Promise<RefundState> {
  const user = await actionUser();
  const str = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
  const orderId = str("order_id");
  try {
    await requestRefund(user, orderId, str("reason"));
  } catch (e) {
    if (e instanceof OrderError) return { error: e.message };
    console.error("[order] refund request failed", e);
    return { error: "Something broke on our side. Nothing changed. Try again in a minute." };
  }
  const origin = await requestOrigin();
  after(async () => {
    const row = await loadOrderAndUser(orderId);
    if (row) await refundRequested(row.order, row.user, origin);
  });
  queueSync({ orders: [orderId] });
  revalidatePath(`/app/orders/${orderId}`);
  revalidatePath("/app/orders");
  return { error: null };
}
