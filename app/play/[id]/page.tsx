import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppFrame } from "@/app/components/ui/bits";
import { playable } from "@/lib/server/play";

// Public, so YSWS reviewers can play an approved ship without an account; anything else needs the
// ?k= key (see playUrl). The app still runs in AppFrame's opaque-origin sandbox, so it can't reach
// this site's cookies.
type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ k?: string | string[] }> };

async function load({ params, searchParams }: Props) {
  const [{ id }, { k }] = await Promise.all([params, searchParams]);
  return playable(id, typeof k === "string" ? k : undefined);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const ship = await load(props);
  return { title: ship ? `${ship.title} · SHRINK` : "SHRINK", robots: { index: false } };
}

export default async function PlayPage(props: Props) {
  const ship = await load(props);
  if (!ship) notFound();
  return <AppFrame uri={ship.dataUri} title={ship.title} className="fixed inset-0 h-full w-full border-0 bg-white" />;
}
