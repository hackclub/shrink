import "server-only";

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { env } from "./env";

function key(): Buffer {
  const raw = env.ENCRYPTION_KEY.trim();
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
  if (buf.every((b) => b === 0)) throw new Error("ENCRYPTION_KEY is all zeros");
  return buf;
}

// `binding` is AAD tying a ciphertext to its row, so a value copied to another row fails to decrypt.
export function encrypt(plain: string, binding: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`v1.${binding}`));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), ct.toString("base64url"), tag.toString("base64url")].join(".");
}

export function decrypt(sealed: string, binding: string): string {
  const [v, iv, ct, tag] = sealed.split(".");
  if (v !== "v1" || !iv || !ct || !tag) throw new Error("bad ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(`v1.${binding}`));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export function encryptJson(value: unknown, binding: string): string {
  return encrypt(JSON.stringify(value), binding);
}

export function decryptJson<T = unknown>(sealed: string, binding: string): T {
  return JSON.parse(decrypt(sealed, binding)) as T;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// A short, unforgeable tag for `s` (64 bits, 11 chars). Good for capability links, not passwords.
export function shortMac(s: string): string {
  return createHmac("sha256", key()).update(`mac.${s}`).digest().subarray(0, 8).toString("base64url");
}
