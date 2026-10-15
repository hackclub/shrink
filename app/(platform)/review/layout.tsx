import { requireRole } from "@/lib/server/auth/current";

import Recorder from "./Recorder";

// Every visit to the desk is recorded (see recorder.ts). A layout, so one recording
// carries on as the reviewer moves between ships.
export default async function ReviewLayout({ children }: { children: React.ReactNode }) {
  await requireRole("reviewer", "/review");
  return (
    <>
      <Recorder />
      {children}
    </>
  );
}
