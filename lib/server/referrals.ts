import "server-only";

import { randomBytes } from "node:crypto";

import { and, asc, eq, isNull, like, sql } from "drizzle-orm";

import { REFERRAL_BITES, pledgeMatches } from "@/lib/program";

import { db, type Tx } from "./db/client";
import { auditEvents, ledgerEntries, ships, users, type User } from "./db/schema";
import * as ledger from "./ledger";

export const REF_COOKIE = "shrink_ref";
export const REF_COOKIE_DAYS = 30;

export class ReferralError extends Error {}

// No 0/O/1/l/I so a link read aloud or retyped still works.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const CODE = /^[a-z2-9]{6}$/;

function newCode(): string {
  return Array.from(randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export const referralKey = (referredUserId: string) => `referral:${referredUserId}`;

export async function createCode(user: User, typed: string): Promise<string> {
  if (user.referralCode) return user.referralCode;
  if (user.referralRevokedAt) throw new ReferralError("Your link was pulled for spam. Talk to an organizer.");
  if (!pledgeMatches(typed)) throw new ReferralError("Type the sentence exactly as it's written.");
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const [row] = await db
      .update(users)
      .set({ referralCode: code })
      .where(and(eq(users.id, user.id), isNull(users.referralCode)))
      .returning({ code: users.referralCode })
      .catch((e) => {
        if ((e as { code?: string }).code === "23505") return [];
        throw e;
      });
    if (row?.code) {
      await db.insert(auditEvents).values({ actorId: user.id, action: "referral.pledge", subject: user.id, detail: { typed } });
      return row.code;
    }
    // Either the code collided or a second tab got there first.
    const [again] = await db.select({ code: users.referralCode }).from(users).where(eq(users.id, user.id));
    if (again?.code) return again.code;
  }
  throw new ReferralError("Couldn't make a link. Try again.");
}

// The id of whoever owns a live link with this code.
export async function referrerFor(code: string | undefined | null): Promise<string | null> {
  if (!code || !CODE.test(code)) return null;
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.referralCode, code), isNull(users.referralRevokedAt)))
    .limit(1);
  return row?.id ?? null;
}

// Runs inside the approval transaction. The ledger key pays each referred
// person out once, on whichever ship of theirs is approved first.
export async function payReferral(tx: Tx, authorId: string, actorId: string): Promise<boolean> {
  const [row] = await tx
    .select({ name: users.slackHandle, referrerId: users.referredById })
    .from(users)
    .where(eq(users.id, authorId))
    .limit(1);
  if (!row?.referrerId || row.referrerId === authorId) return false;
  const [referrer] = await tx.select({ revoked: users.referralRevokedAt }).from(users).where(eq(users.id, row.referrerId)).limit(1);
  if (!referrer || referrer.revoked) return false;
  return ledger.post(tx, {
    userId: row.referrerId,
    amount: REFERRAL_BITES,
    type: "award",
    reason: `referral: ${row.name ? `@${row.name}` : authorId}`,
    idempotencyKey: referralKey(authorId),
    actorId,
  });
}

export type Referred = {
  id: string;
  name: string;
  avatarUrl: string | null;
  joinedAt: Date;
  status: "joined" | "shipped" | "paid" | "void";
};

// Drizzle leaves columns unqualified in a single-table select, so a correlated
// subquery has to name the outer row itself.
const outerId = sql.raw(`"users"."id"`);

export async function referralsOf(user: User): Promise<{ people: Referred[]; earned: number }> {
  const [rows, [earned]] = await Promise.all([
    db
      .select({
        id: users.id,
        name: sql<string>`coalesce('@' || ${users.slackHandle}, 'someone')`,
        avatarUrl: users.avatarUrl,
        joinedAt: users.createdAt,
        shipped: sql<boolean>`exists (select 1 from ${ships} s where s.user_id = ${outerId})`,
        approved: sql<boolean>`exists (select 1 from ${ships} s where s.user_id = ${outerId} and s.state = 'approved')`,
        paid: sql<boolean>`exists (select 1 from ${ledgerEntries} l where l.idempotency_key = 'referral:' || ${outerId})`,
      })
      .from(users)
      .where(eq(users.referredById, user.id))
      .orderBy(asc(users.createdAt)),
    db
      .select({ n: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)::int` })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.userId, user.id), like(ledgerEntries.idempotencyKey, "referral:%"))),
  ]);
  const people = rows.map((r): Referred => ({
    id: r.id,
    name: r.name,
    avatarUrl: r.avatarUrl,
    joinedAt: r.joinedAt,
    // Approved but unpaid means the link was pulled before they shipped.
    status: r.paid ? "paid" : r.approved ? "void" : r.shipped ? "shipped" : "joined",
  }));
  return { people, earned: earned?.n ?? 0 };
}

export async function setRevoked(admin: User, userId: string, revoked: boolean): Promise<void> {
  await db.update(users).set({ referralRevokedAt: revoked ? new Date() : null }).where(eq(users.id, userId));
  await db.insert(auditEvents).values({ actorId: admin.id, action: revoked ? "referral.revoke" : "referral.restore", subject: userId });
}
