import { cookies } from "next/headers";

import { requireRole } from "@/lib/server/auth/current";

import Recorder from "./Recorder";
import { THEME_COOKIE, parseTheme } from "./theme";

// Every visit to the desk is recorded (see recorder.ts). A layout, so one recording
// carries on as the reviewer moves between ships.
export default async function ReviewLayout({ children }: { children: React.ReactNode }) {
  await requireRole("reviewer", "/review");
  // Read here, not in the browser, so a dark desk never flashes light first.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div data-desk-theme={theme} className="contents">
      <Recorder />
      {children}
    </div>
  );
}
