"use client";

import { Moon, Sun } from "lucide-react";

import { THEME_COOKIE } from "./theme";

// Flips the desk between light and dark. Which icon shows is pure CSS (dark:), so it's
// right on first paint even when the desk is following the OS.
export default function ThemeToggle() {
  const flip = (e: React.MouseEvent<HTMLButtonElement>) => {
    const root = e.currentTarget.closest<HTMLElement>("[data-desk-theme]");
    if (!root) return;
    const cur = root.dataset.deskTheme;
    const dark = cur === "dark" || (cur === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    const next = dark ? "light" : "dark";
    root.dataset.deskTheme = next;
    document.cookie = `${THEME_COOKIE}=${next}; path=/review; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  };
  return (
    <button
      type="button"
      onClick={flip}
      title="Light / dark"
      aria-label="Toggle dark mode"
      className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Moon className="size-3.5 dark:hidden" />
      <Sun className="hidden size-3.5 dark:block" />
    </button>
  );
}
