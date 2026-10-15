"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="no-scrollbar -mx-2 flex items-center gap-1 overflow-x-auto px-2 text-[0.95rem] font-medium">
      {links.map((l) => {
        const active = l.href === "/app" ? path === "/app" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-[4px] px-2 py-1 transition-colors ${
              active ? "bg-accent text-black" : "text-foreground/60 hover:bg-foreground/5 hover:text-foreground"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
