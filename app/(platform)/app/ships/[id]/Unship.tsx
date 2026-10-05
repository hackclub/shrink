"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import PixelButton from "@/app/components/PixelButton";
import { Notice } from "@/app/components/ui/bits";

import { unshipAction } from "../../ship/actions";
import { draftKey, saveDraft } from "../../ship/draft";

type Props = {
  id: string;
  reshipOf: string | null;
  title: string;
  description: string;
  dataUri: string;
  sourceUrl: string;
  hackatimeProjects: string[];
  claimedBadges: string[];
};

// Pulls a ship out of review and drops it back into the ship form as a draft, so
// the author can change it and ship again.
export default function Unship(p: Props) {
  const router = useRouter();
  const [sure, setSure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const go = () =>
    start(async () => {
      const res = await unshipAction(p.id);
      if (res.error) return setError(res.error);
      saveDraft(draftKey(p.reshipOf), {
        step: 0,
        uri: p.dataUri,
        title: p.title,
        description: p.description,
        sourceUrl: p.sourceUrl,
        projects: p.hackatimeProjects,
        badges: p.claimedBadges,
      });
      router.push(p.reshipOf ? `/app/ship?from=${p.reshipOf}` : "/app/ship");
    });

  return (
    <div className="card bg-white px-5 py-4">
      <p className="label">in review</p>
      <p className="font-medium leading-relaxed text-black/85">
        {sure
          ? "This takes it out of the queue. Everything you entered comes back as a draft, so you can change it and ship again."
          : "Spotted something to fix? Unship it while it's waiting and ship it again when it's ready."}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {sure ? (
          <>
            <PixelButton variant="dark" onClick={go} disabled={pending}>
              {pending ? "unshipping…" : "yes, unship it"}
            </PixelButton>
            <PixelButton onClick={() => setSure(false)} disabled={pending}>
              keep it in review
            </PixelButton>
          </>
        ) : (
          <PixelButton onClick={() => setSure(true)}>unship</PixelButton>
        )}
      </div>
      {error && (
        <div className="mt-3">
          <Notice>{error}</Notice>
        </div>
      )}
    </div>
  );
}
