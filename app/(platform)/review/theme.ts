// The desk's light/dark choice. "system" (no cookie) follows the OS.
export type DeskTheme = "light" | "dark" | "system";
export const THEME_COOKIE = "desk-theme";

export function parseTheme(v: string | undefined): DeskTheme {
  return v === "light" || v === "dark" ? v : "system";
}
