import { readFile } from "node:fs/promises";
import { join } from "node:path";

// rrweb's recorder as one plain script, for the desk to inline into the preview frame
// (app/(platform)/review/frame-recorder.ts). Read at build time, so it's just a static file.
export const dynamic = "force-static";

export async function GET() {
  const src = await readFile(join(process.cwd(), "node_modules/@rrweb/record/dist/record.umd.min.cjs"), "utf8");
  return new Response(src.replace(/\n\/\/# sourceMappingURL=\S+\s*$/, ""), {
    headers: { "content-type": "text/javascript; charset=utf-8" },
  });
}
