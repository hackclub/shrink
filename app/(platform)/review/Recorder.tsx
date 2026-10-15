"use client";

import { useEffect } from "react";

import { markRecording, setReviewing, startRecording } from "./recorder";

export default function Recorder() {
  useEffect(() => startRecording(), []);
  return null;
}

// Drops a marker into the recording when a ship opens, so a replay can be matched to it.
// While `reviewing` (open for a decision, not just looked at), active time goes to it.
export function ReplayMark({ shipId, number, reviewing }: { shipId: string; number: number; reviewing: boolean }) {
  useEffect(() => markRecording("ship", { shipId, number, reviewing }), [shipId, number, reviewing]);
  useEffect(() => {
    if (!reviewing) return;
    setReviewing(shipId);
    return () => setReviewing(null);
  }, [shipId, reviewing]);
  return null;
}
