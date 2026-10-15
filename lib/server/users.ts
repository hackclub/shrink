import "server-only";

import { and, eq, isNull, or, sql } from "drizzle-orm";

import { queueSync } from "./airtable";
import { encrypt } from "./crypto";
import { db } from "./db/client";
import { users, type User } from "./db/schema";
import { env } from "./env";
import { checkIdentity, deriveEligibility, type Identity, type Tokens } from "./auth/hca";

// How a person appears to anyone who isn't an admin.
export const publicName = (u: Pick<User, "slackHandle">) => (u.slackHandle ? `@${u.slackHandle}` : "someone");

export const tokenBinding = (userId: string) => `users/${userId}/hca_token`;

// `referrerId` only sticks to someone signing in for the first time: a new row,
// or a Slack join placeholder that's never been signed into.
export async function upsertFromSignIn(identity: Identity, tokens: Tokens, referrerId: string | null = null): Promise<User> {
  const [check, slack] = await Promise.all([
    checkIdentity(identity.sub),
    identity.slackId ? slackProfile(identity.slackId) : null,
  ]);
  const eligibility = deriveEligibility(identity.verificationStatus, check);
  const bootstrapAdmin =
    env.ADMIN_HCA_SUBJECTS.includes(identity.sub) || env.ADMIN_EMAILS.includes(identity.email.toLowerCase());
  const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null;

  // Someone who joined from Slack already has a row with no HCA subject; claim
  // it so their Airtable record and Slack sign-up time carry over.
  const [existing] = await db
    .select()
    .from(users)
    .where(
      identity.slackId
        ? or(eq(users.hcaSubject, identity.sub), and(eq(users.slackId, identity.slackId), isNull(users.hcaSubject)))
        : eq(users.hcaSubject, identity.sub),
    )
    // Prefer the row that's already theirs over an unclaimed Slack one.
    .orderBy(sql`${users.hcaSubject} is null`)
    .limit(1);
  const base = {
    email: identity.email,
    displayName: identity.name,
    slackId: identity.slackId ?? existing?.slackId ?? null,
    slackHandle: slack?.handle ?? existing?.slackHandle ?? null,
    verificationStatus: identity.verificationStatus,
    eligibility,
    eligibilityAt: new Date(),
    birthdate: identity.birthdate ?? existing?.birthdate ?? null,
    hcaTokenExpiresAt: expiresAt,
    lastSeenAt: new Date(),
  };

  if (existing) {
    const [row] = await db
      .update(users)
      .set({
        ...base,
        hcaSubject: identity.sub,
        ...(existing.hcaSubject ? {} : { referredById: existing.referredById ?? referrerId }),
        role: bootstrapAdmin && existing.role !== "admin" ? "admin" : existing.role,
        hcaTokenEncrypted: encrypt(tokens.access_token, tokenBinding(existing.id)),
      })
      .where(eq(users.id, existing.id))
      .returning();
    queueSync({ users: [row.id] });
    return row;
  }

  const [created] = await db
    .insert(users)
    .values({ ...base, hcaSubject: identity.sub, role: bootstrapAdmin ? "admin" : "participant", referredById: referrerId })
    .returning();
  const [row] = await db
    .update(users)
    .set({ hcaTokenEncrypted: encrypt(tokens.access_token, tokenBinding(created.id)) })
    .where(eq(users.id, created.id))
    .returning();
  queueSync({ users: [row.id] });
  return row;
}

const ELIGIBILITY_MAX_AGE_MS = 6 * 3600_000;

export async function currentEligibility(user: User): Promise<User["eligibility"]> {
  const fresh = user.eligibilityAt && Date.now() - user.eligibilityAt.getTime() < ELIGIBILITY_MAX_AGE_MS;
  if (fresh && user.eligibility === "eligible") return user.eligibility;
  if (!user.hcaSubject) return user.eligibility;
  const check = await checkIdentity(user.hcaSubject);
  if (check === "unavailable") return user.eligibility;
  const eligibility = deriveEligibility(user.verificationStatus, check);
  await db.update(users).set({ eligibility, eligibilityAt: new Date() }).where(eq(users.id, user.id));
  if (eligibility !== user.eligibility) queueSync({ users: [user.id] });
  return eligibility;
}

export const SLACK_ID = /^[UW][A-Z0-9]{6,20}$/;

// `handle` is the only part anyone but an admin gets to see. It never falls back to
// real_name: that's often their legal name.
type SlackProfile = { name: string | null; handle: string | null; email: string | null; avatar: string | null };

async function slackProfile(slackId: string): Promise<SlackProfile> {
  const none = { name: null, handle: null, email: null, avatar: null };
  if (!env.SLACK_BOT_TOKEN) return none;
  try {
    const res = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(slackId)}`, {
      headers: { authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      error?: string;
      user?: { name?: string; real_name?: string; profile?: { display_name?: string; real_name?: string; email?: string; image_192?: string } };
    };
    if (!json.ok || !json.user) {
      console.error(`[slack] users.info ${slackId} failed: ${json.error ?? res.status}`);
      return none;
    }
    const p = json.user.profile ?? {};
    return {
      name: p.display_name || p.real_name || json.user.real_name || null,
      handle: p.display_name || json.user.name || null,
      email: p.email || null,
      avatar: p.image_192 || null,
    };
  } catch (e) {
    console.error(`[slack] users.info ${slackId} threw`, e);
    return none;
  }
}

// Called by the Slack "join" button. Creates a placeholder user (no HCA subject,
// not onboarded) so they show up in Airtable right away; signing in later claims
// the row in upsertFromSignIn and still walks them through /welcome.
export async function joinFromSlack(slackId: string): Promise<{ user: User; created: boolean }> {
  const [known] = await db.select().from(users).where(eq(users.slackId, slackId)).limit(1);
  if (known) return { user: known, created: false };

  const profile = await slackProfile(slackId);
  const result = await db.transaction(async (tx) => {
    // Slack retries and double clicks: only one row per Slack ID.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`slack-join:${slackId}`}))`);
    const [again] = await tx.select().from(users).where(eq(users.slackId, slackId)).limit(1);
    if (again) return { user: again, created: false };
    const [user] = await tx
      .insert(users)
      .values({
        slackId,
        email: profile.email ?? "",
        displayName: profile.name ?? slackId,
        slackHandle: profile.handle,
        avatarUrl: profile.avatar,
      })
      .returning();
    return { user, created: true };
  });
  if (result.created) queueSync({ users: [result.user.id] });
  return result;
}

// For people who signed in before handles were stored. Fills at most `limit` per
// call so a page load never waits on more than one round of Slack lookups.
export async function fillSlackHandles(people: Pick<User, "id" | "slackId" | "slackHandle">[], limit = 10): Promise<void> {
  const missing = [...new Map(people.filter((p) => p.slackId && !p.slackHandle).map((p) => [p.id, p])).values()].slice(0, limit);
  if (!missing.length || !env.SLACK_BOT_TOKEN) return;
  const found = await Promise.all(missing.map(async (p) => ({ p, handle: (await slackProfile(p.slackId!)).handle })));
  for (const { p, handle } of found) {
    if (!handle) continue;
    await db.update(users).set({ slackHandle: handle }).where(and(eq(users.id, p.id), isNull(users.slackHandle)));
    for (const q of people) if (q.id === p.id) q.slackHandle = handle;
  }
}
