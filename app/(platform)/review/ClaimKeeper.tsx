"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { claimAction, releaseAction } from "./actions";

// Keeps this reviewer's hold on the open ship alive (see claim() in lib/server/ships.ts),
// and lets it go when they leave. If someone took it after the hold lapsed (laptop
// asleep), refresh so the desk shows it's theirs now.
export default function ClaimKeeper({ shipId }: { shipId: string }) {
  const router = useRouter();
  useEffect(() => {
    let lost = false;
    const renew = async () => {
      if (lost) return;
      const r = await claimAction(shipId).catch(() => null);
      if (r && !r.ok) {
        lost = true;
        router.refresh();
      }
    };
    // The page render already claimed it; renewing now too covers a remount after a release.
    renew();
    const id = setInterval(renew, 60_000);
    const onVisible = () => document.visibilityState === "visible" && renew();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      if (!lost) releaseAction(shipId).catch(() => {});
    };
  }, [shipId, router]);
  return null;
}
