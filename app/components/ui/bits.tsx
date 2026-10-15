import Link from "next/link";

import { MAX_URI_BYTES, hm } from "@/lib/program";
import type { Ship } from "@/lib/server/db/schema";

import { pixelButtonClass, pixelButtonVariants } from "../PixelButton";

export function Rule({ className = "" }: { className?: string }) {
  return <hr className={`rule ${className}`} />;
}

export function H1({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-[clamp(1.25rem,2vw,32px)]">
      <h1 className="text-[length:var(--text-display)] font-semibold leading-[1.15] tracking-tight">{children}</h1>
      {sub && <p className="mt-2 max-w-[60ch] text-[length:var(--text-lead)] font-medium text-black/70">{sub}</p>}
    </div>
  );
}

export function PixelLink({
  href,
  children,
  variant = "light",
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  variant?: keyof typeof pixelButtonVariants;
  className?: string;
}) {
  const base = pixelButtonClass.replace(pixelButtonVariants.light, pixelButtonVariants[variant]);
  return (
    <Link href={href} className={`${base} ${className}`}>
      {children}
    </Link>
  );
}

export function StatePill({ state }: { state: Ship["state"] }) {
  const label = { pending: "in review", approved: "approved", rejected: "sent back" }[state];
  return <span className={`pill pill-${state}`}>{label}</span>;
}

export function ByteMeter({ bytes, className = "" }: { bytes: number; className?: string }) {
  const pct = Math.min(100, Math.round((bytes / MAX_URI_BYTES) * 100));
  const over = bytes > MAX_URI_BYTES;
  return (
    <div className={className} role="img" aria-label={`${bytes} of ${MAX_URI_BYTES} bytes`}>
      <div className="h-[6px] w-full overflow-hidden rounded-full bg-black/10">
        <div className={`h-full rounded-full ${over ? "bg-[#c1121f]" : "size-bar"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className={`mt-[0.45em] font-mono text-[0.75rem] leading-none tabular-nums ${over ? "text-[#c1121f]" : "text-black/50"}`}>
        {bytes.toLocaleString()} / {MAX_URI_BYTES.toLocaleString()} bytes{over ? " — too big" : ` (${pct}%)`}
      </p>
    </div>
  );
}

// Blocks all network. A page can only tighten a meta CSP, never loosen it, so it must come first.
const FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' data: blob:",
  "style-src 'unsafe-inline' data:",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "worker-src data: blob:",
  "connect-src data: blob:",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

export function decodeHtml(uri: string): string {
  const comma = uri.indexOf(",");
  if (comma < 0) return "";
  const head = uri.slice(0, comma);
  const body = uri.slice(comma + 1);
  try {
    if (/;base64$/i.test(head)) return new TextDecoder().decode(Uint8Array.from(atob(body.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
    const bytes: number[] = [];
    const enc = new TextEncoder();
    for (let i = 0; i < body.length; i++) {
      const hex = body[i] === "%" ? body.slice(i + 1, i + 3) : "";
      if (/^[0-9a-f]{2}$/i.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
      } else {
        const cp = body.codePointAt(i)!;
        if (cp > 0xffff) i++;
        bytes.push(...enc.encode(String.fromCodePoint(cp)));
      }
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return body;
  }
}

// Meta goes after any doctype so standards/quirks mode is preserved.
export function frameDoc(uri: string): string {
  const html = decodeHtml(uri);
  const meta = `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`;
  const doctype = html.match(/^\s*<!doctype[^>]*>/i);
  return doctype ? doctype[0] + meta + html.slice(doctype[0].length) : meta + html;
}

// No allow-same-origin: opaque origin, so the app can't touch this page or its cookies.
// frame-src in next.config.ts stops the frame navigating out from under FRAME_CSP.
export function AppFrame({ uri, title, className = "" }: { uri: string; title: string; className?: string }) {
  return (
    <iframe
      srcDoc={frameDoc(uri)}
      title={title}
      sandbox="allow-scripts allow-pointer-lock"
      referrerPolicy="no-referrer"
      loading="lazy"
      className={`app-frame ${className}`}
    />
  );
}

export function Notice({ kind = "error", children }: { kind?: "error" | "ok"; children: React.ReactNode }) {
  return (
    <p role={kind === "error" ? "alert" : "status"} className={`notice notice-${kind}`}>
      {children}
    </p>
  );
}

export function Hours({ seconds }: { seconds: number }) {
  return <span className="font-mono">{hm(seconds)}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 border-t-4 border-rule py-8">
      <p className="max-w-[52ch] text-[length:var(--text-lead)] font-medium leading-[1.4] text-black/60">{children}</p>
    </div>
  );
}

export function when(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
