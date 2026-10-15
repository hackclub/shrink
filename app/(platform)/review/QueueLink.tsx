"use client";

import Link, { useLinkStatus } from "next/link";

import { cn } from "@/lib/utils";

// Not prefetched: rendering a ship claims it. So the row itself shows the wait instead.
export default function QueueLink({ href, active, dimmed, children }: { href: string; active: boolean; dimmed: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex flex-col gap-0.5 px-3 py-2 transition-colors",
        active ? "bg-muted before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-foreground" : "hover:bg-muted/60",
        dimmed && "opacity-55",
      )}
    >
      {children}
      <Pending />
    </Link>
  );
}

function Pending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={cn("pointer-events-none absolute inset-0 bg-muted transition-opacity", pending ? "animate-pulse opacity-70" : "opacity-0")} />;
}
