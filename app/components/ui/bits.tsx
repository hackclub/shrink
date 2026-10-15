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
    // Browsers percent-decode the body before base64-decoding it, so "%2B" and "%3D" are fine.
    if (/;base64$/i.test(head)) {
      const b64 = body.replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/[^A-Za-z0-9+/=]/g, "");
      return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    }
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

// Things a sandboxed srcdoc frame refuses that a page in its own tab allows, patched so an app
// that works in a tab works on the desk too. Storage throws in both (opaque origin), so an
// in-memory one is a strict improvement: a high score lasts for the session instead of crashing
// the app at load. pushState resolves URLs against the desk's URL and throws; fall back to the hash.
const FRAME_SHIM = `<script>(function(){
  function mem(){var m=new Map(),api={get length(){return m.size},key:function(i){return Array.from(m.keys())[i]??null},getItem:function(k){return m.has(String(k))?m.get(String(k)):null},setItem:function(k,v){m.set(String(k),String(v))},removeItem:function(k){m.delete(String(k))},clear:function(){m.clear()}};
    return new Proxy(api,{get:function(t,k){return k in t?t[k]:typeof k==="string"&&m.has(k)?m.get(k):undefined},set:function(t,k,v){m.set(String(k),String(v));return true},deleteProperty:function(t,k){m.delete(String(k));return true},has:function(t,k){return k in t||m.has(String(k))},ownKeys:function(){return Array.from(m.keys())},getOwnPropertyDescriptor:function(t,k){return m.has(String(k))?{value:m.get(String(k)),enumerable:true,configurable:true,writable:true}:undefined}})}
  ["localStorage","sessionStorage"].forEach(function(n){try{window[n].length}catch(e){try{Object.defineProperty(window,n,{value:mem(),configurable:true})}catch(e2){}}});
  try{document.cookie}catch(e){var jar=new Map();try{Object.defineProperty(document,"cookie",{configurable:true,get:function(){return Array.from(jar,function(p){return p[0]+"="+p[1]}).join("; ")},set:function(s){var kv=String(s).split(";")[0],i=kv.indexOf("="),k=(i<0?kv:kv.slice(0,i)).trim(),v=i<0?"":kv.slice(i+1).trim();if(/max-age=0|expires=.*19(7|6)\d/i.test(s))jar.delete(k);else if(k)jar.set(k,v)}})}catch(e2){}}
  ["pushState","replaceState"].forEach(function(n){var o=history[n];history[n]=function(s,t,u){try{return o.call(history,s,t,u)}catch(e){if(u!=null){var h=String(u),i=h.indexOf("#");if(i>=0)location.hash=h.slice(i)}}}});
  if(document.currentScript)document.currentScript.remove();
})()</script>`;

// Meta goes after any doctype so standards/quirks mode is preserved, then the shim, then `head`,
// all ahead of anything in the app.
export function frameDoc(uri: string, head = ""): string {
  const html = decodeHtml(uri);
  const meta = `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">${FRAME_SHIM}${head}`;
  const doctype = html.match(/^\s*<!doctype[^>]*>/i);
  return doctype ? doctype[0] + meta + html.slice(doctype[0].length) : meta + html;
}

// No allow-same-origin: opaque origin, so the app can't touch this page or its cookies.
// frame-src in next.config.ts stops the frame navigating out from under FRAME_CSP.
// `interactive` is for a frame the person is there to use (the desk, /play), not a showcase
// thumbnail, and lets it do what a page in its own tab can: allow-modals, since alert/prompt/
// confirm are silently no-ops without it and prompt() returning null breaks a lot of "what's
// your name?" apps; allow-forms, since without it the submit event never fires and a to-do
// app's form does nothing (FRAME_CSP's form-action still stops the submission going anywhere);
// allow-downloads for "save your drawing" buttons; and fullscreen.
// `focus` gives the frame keyboard focus on load, like a page in its own tab has, so a game
// that listens for arrow keys works without the reviewer clicking into it first.
export function AppFrame({
  uri,
  title,
  className = "",
  head,
  interactive = false,
  focus = false,
}: {
  uri: string;
  title: string;
  className?: string;
  head?: string;
  interactive?: boolean;
  focus?: boolean;
}) {
  return (
    <iframe
      srcDoc={frameDoc(uri, head)}
      title={title}
      sandbox={interactive ? "allow-scripts allow-pointer-lock allow-modals allow-forms allow-downloads" : "allow-scripts allow-pointer-lock"}
      allowFullScreen={interactive}
      referrerPolicy="no-referrer"
      // Lazy is for thumbnails in a long list; the frame the person came for loads at once.
      loading={interactive ? "eager" : "lazy"}
      className={`app-frame ${className}`}
      onLoad={focus ? (e) => e.currentTarget.focus() : undefined}
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
