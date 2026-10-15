import { Empty, H1 } from "@/app/components/ui/bits";
import { requireUser } from "@/lib/server/auth/current";
import { showcase } from "@/lib/server/ships";

import ShowcaseCard from "../ShowcaseCard";

export default async function ExplorePage() {
  await requireUser("/app/explore");
  const approved = await showcase(200);

  return (
    <>
      <H1>explore</H1>
      {approved.length === 0 ? (
        <Empty>Nothing&apos;s been approved yet.</Empty>
      ) : (
        <ul className="grid grid-cols-2 gap-[clamp(10px,1vw,20px)] sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {approved.map((sh) => (
            <li key={sh.id}>
              <ShowcaseCard
                href={`/app/ships/${sh.id}`}
                title={sh.title}
                uri={sh.dataUri}
                meta={`${sh.author ? `@${sh.author}` : "someone"} · ${(sh.bytes / 1024).toFixed(1)}kb`}
                chip={`${sh.awardedBites} BITES`}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
