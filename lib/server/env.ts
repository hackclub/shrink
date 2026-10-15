import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export const env = {
  get DATABASE_URL() {
    return required("DATABASE_URL");
  },
  get ENCRYPTION_KEY() {
    return required("ENCRYPTION_KEY");
  },

  HCA_HOST: process.env.HCA_HOST ?? "https://auth.hackclub.com",
  HCA_CLIENT_ID: process.env.HCA_CLIENT_ID ?? "",
  HCA_CLIENT_SECRET: process.env.HCA_CLIENT_SECRET ?? "",
  HCA_SCOPES:
    process.env.HCA_SCOPES ??
    "openid profile email slack_id verification_status address birthdate",

  HACKATIME_HOST: process.env.HACKATIME_HOST ?? "https://hackatime.hackclub.com",
  HACKATIME_CLIENT_ID: process.env.HACKATIME_CLIENT_ID ?? "",
  HACKATIME_CLIENT_SECRET: process.env.HACKATIME_CLIENT_SECRET ?? "",

  GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? "",
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? "",
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL ?? "google/gemini-3.8-flash",
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",

  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN ?? "",
  SLACK_CHANNEL_ID: process.env.SLACK_CHANNEL_ID ?? "",
  // #shrink; participants are invited when they finish /welcome. Empty disables it.
  SLACK_PROGRAM_CHANNEL_ID: process.env.SLACK_PROGRAM_CHANNEL_ID ?? "C0AQTQMV2SJ",
  // DMs to participants (ship decisions, order updates) are on unless SLACK_DMS=0.
  SLACK_DMS: process.env.SLACK_DMS !== "0" && process.env.SLACK_DMS !== "false",

  AIRTABLE_API_KEY: process.env.AIRTABLE_API_KEY ?? "",
  AIRTABLE_BASE_ID: process.env.AIRTABLE_BASE_ID ?? "",
  AIRTABLE_USERS_TABLE: process.env.AIRTABLE_USERS_TABLE ?? "Users",
  AIRTABLE_SHIPS_TABLE: process.env.AIRTABLE_SHIPS_TABLE ?? "Ships",
  AIRTABLE_ORDERS_TABLE: process.env.AIRTABLE_ORDERS_TABLE ?? "Orders",
  AIRTABLE_YSWS_TABLE: process.env.AIRTABLE_YSWS_TABLE ?? "YSWS Project Submission",
  // Vercel Web Analytics, for the visitor count on /stats.
  VERCEL_TOKEN: process.env.VERCEL_TOKEN ?? "",
  VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID ?? "",
  VERCEL_TEAM_ID: process.env.VERCEL_TEAM_ID ?? "",
  CRON_SECRET: process.env.CRON_SECRET ?? "",
  // Secondary check on every ship. Empty key turns it off: approvals land straight away.
  SECONDARY_CHECK_KEY: process.env.SECONDARY_CHECK_KEY ?? "",
  SECONDARY_CHECK_URL: (process.env.SECONDARY_CHECK_URL ?? "https://telescreen.hackclub.com").replace(/\/$/, ""),
  // Shared secret for POST /api/slack/join (the Slack "join" button's webhook).
  SLACK_JOIN_SECRET: process.env.SLACK_JOIN_SECRET ?? "",
  // Public origin for links written to Airtable from the cron job.
  APP_URL: (process.env.APP_URL ?? "").replace(/\/$/, ""),

  ADMIN_EMAILS: (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  ADMIN_HCA_SUBJECTS: (process.env.ADMIN_HCA_SUBJECTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

export function staging(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const flag = process.env.STAGING;
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return true;
  return !env.HCA_CLIENT_ID;
}

export function stagingRole(): "participant" | "reviewer" | "admin" {
  const r = process.env.STAGING_ROLE;
  return r === "participant" || r === "reviewer" ? r : "admin";
}
