import { PixelLink } from "@/app/components/ui/bits";
import { MAX_URI_BYTES, PROGRAM_END, PROGRAM_START, instant } from "@/lib/program";
import { requireUser } from "@/lib/server/auth/current";

import { stayInSetup } from "./guard";
import Panel from "./Panel";

const day = (d: string) => instant(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const HOW = [
  { t: "build", d: `any web app, written as one data:text/html line of ${MAX_URI_BYTES.toLocaleString()} bytes or less.` },
  { t: "track", d: "Hackatime logs your hours from your editor." },
  { t: "ship", d: "submit the line and your repo. a reviewer tries it out." },
  { t: "spend", d: "approved hours turn into BITES for the shop." },
];

export default async function Welcome({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const user = await requireUser("/welcome");
  const previewing = stayInSetup(user, (await searchParams).preview);
  const qs = previewing ? "?preview" : "";

  return (
    <>
      <h1 className="text-[length:var(--text-display)] font-semibold leading-[1.1] tracking-tight">
        welcome to <span className="wordmark">SHRINK</span>
      </h1>
      <p className="mt-3 max-w-[52ch] text-[length:var(--text-lead)] font-medium leading-snug text-black/70">
        fit a web app into one line. {day(PROGRAM_START)} to {day(PROGRAM_END)}.
      </p>

      <div className="mt-8">
        <Panel title="how it works">
          <ol className="flex flex-col gap-4">
            {HOW.map((h, i) => (
              <li key={h.t} className="flex gap-3">
                <span className="grid size-7 shrink-0 place-content-center rounded-[5px] bg-accent font-pixel text-[0.95rem] leading-none">{i + 1}</span>
                <span>
                  <span className="block font-semibold tracking-tight">{h.t}</span>
                  <span className="block text-sm font-medium leading-snug text-black/60">{h.d}</span>
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <div className="mt-8 flex justify-end">
        <PixelLink href={`/welcome/setup${qs}`} variant="dark" className="text-[1.2rem]">
          let&apos;s go →
        </PixelLink>
      </div>
    </>
  );
}
