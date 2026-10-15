"use client";

import { BookOpen, ChevronRight, ExternalLink, File, Folder, FolderOpen, Loader2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { Card } from "@/app/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import type { RepoView } from "@/lib/server/scan";
import { cn } from "@/lib/utils";

import { repoFileAction } from "./actions";

type Gh = Extract<RepoView, { kind: "github" }>;
type Node = { name: string; path: string; size: number; children: Node[] | null };

const IMAGE = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i;
const MARKDOWN = /\.(md|markdown|mdx)$/i;

// README and a file browser for the ship's repo, so reviewers can read the code without leaving the desk.
export default function Repo({ shipId, repo }: { shipId: string; repo: RepoView }) {
  if (repo.kind !== "github") {
    return (
      <Card className="gap-0 py-0">
        <Header />
        <p className="px-4 py-6 text-sm text-muted-foreground">{repo.why}</p>
      </Card>
    );
  }
  return <Browser key={`${shipId}@${repo.ref}`} shipId={shipId} repo={repo} />;
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
      <span className="text-sm font-medium">Repo</span>
      {children}
    </div>
  );
}

function Browser({ shipId, repo }: { shipId: string; repo: Gh }) {
  const [tab, setTab] = useState(repo.readme ? "readme" : "files");
  const [open, setOpen] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, { text: string } | { error: string }>>({});
  const [pending, start] = useTransition();
  const readmePath = repo.files.find((f) => /^readme(\.[\w.]+)?$/i.test(f.path))?.path ?? "README.md";
  const paths = useMemo(() => new Set(repo.files.map((f) => f.path)), [repo.files]);
  const raw = (path: string) => `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${repo.ref}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const blob = (path: string) => `${repo.url}/blob/${repo.ref}/${path.split("/").map(encodeURIComponent).join("/")}`;

  const show = (path: string) => {
    setTab("files");
    setOpen(path);
    if (files[path] || IMAGE.test(path)) return;
    start(async () => {
      const r = await repoFileAction(shipId, repo.ref, path).catch(() => ({ error: "Couldn't load that file." }));
      setFiles((m) => ({ ...m, [path]: r }));
    });
  };

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Tabs value={tab} onValueChange={setTab} className="gap-0">
        <Header>
          <TabsList className="h-8">
            <TabsTrigger value="readme" disabled={!repo.readme}>
              README
            </TabsTrigger>
            <TabsTrigger value="files">
              Files <span className="font-mono text-xs text-muted-foreground">{repo.files.length}</span>
            </TabsTrigger>
          </TabsList>
        </Header>
        <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          <span className="truncate font-mono">
            {repo.owner}/{repo.repo}
            {repo.ref !== "HEAD" && <span title={repo.ref}> @ {repo.ref.slice(0, 7)}</span>}
          </span>
          <span className="shrink-0 max-sm:hidden">Latest commit, not necessarily what was shipped</span>
        </div>

        <TabsContent value="readme">
          {repo.readme && (
            <div className="max-h-[70svh] overflow-y-auto px-6 py-5">
              {MARKDOWN.test(readmePath) ? (
                <Readme text={repo.readme} base={readmePath} paths={paths} raw={raw} blob={blob} show={show} />
              ) : (
                <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap">{repo.readme}</pre>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="files">
          {repo.files.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">The repo has no files.</p>
          ) : (
            <div className="grid h-[70svh] grid-cols-1 grid-rows-[12rem_minmax(0,1fr)] md:grid-cols-[240px_minmax(0,1fr)] md:grid-rows-1">
              <Tree files={repo.files} open={open} onOpen={show} />
              <div className="flex min-h-0 min-w-0 flex-col border-t md:border-t-0 md:border-l">
                {!open ? (
                  <p className="m-auto text-sm text-muted-foreground">Pick a file.</p>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
                      <span className="truncate font-mono text-xs">{open}</span>
                      <a href={blob(open)} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                        GitHub <ExternalLink className="size-3" />
                      </a>
                    </div>
                    <Viewer path={open} file={files[open]} loading={pending && !files[open]} raw={raw} />
                  </>
                )}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </Card>
  );
}

function Viewer({ path, file, loading, raw }: { path: string; file?: { text: string } | { error: string }; loading: boolean; raw: (p: string) => string }) {
  if (IMAGE.test(path)) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-auto bg-[repeating-conic-gradient(#f4f4f5_0_25%,white_0_50%)] bg-[length:16px_16px] p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={raw(path)} alt={path} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }
  if (loading || !file) {
    return (
      <div className="m-auto flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading
      </div>
    );
  }
  if ("error" in file) return <p className="m-auto px-4 text-center text-sm text-muted-foreground">{file.error}</p>;
  const lines = file.text.replace(/\n$/, "").split("\n");
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse font-mono text-xs leading-5">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="w-px select-none border-r bg-muted/40 px-2 text-right align-top text-muted-foreground">{i + 1}</td>
              <td className="px-3 align-top whitespace-pre">{l || " "}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function buildTree(files: { path: string; size: number }[]): Node[] {
  const root: Node = { name: "", path: "", size: 0, children: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let dir = root;
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join("/");
      if (i === parts.length - 1) {
        dir.children!.push({ name, path, size: f.size, children: null });
        return;
      }
      let next = dir.children!.find((c) => c.children && c.name === name);
      if (!next) dir.children!.push((next = { name, path, size: 0, children: [] }));
      dir = next;
    });
  }
  const sort = (nodes: Node[]) => {
    nodes.sort((a, b) => (!!b.children === !!a.children ? a.name.localeCompare(b.name) : b.children ? 1 : -1));
    for (const n of nodes) if (n.children) sort(n.children);
    return nodes;
  };
  return sort(root.children!);
}

function Tree({ files, open, onOpen }: { files: { path: string; size: number }[]; open: string | null; onOpen: (path: string) => void }) {
  const tree = useMemo(() => buildTree(files), [files]);
  // Small repos start fully expanded; big ones start at the top level.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (files.length > 60) return new Set();
    return new Set(files.flatMap((f) => f.path.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/"))));
  });
  const toggle = (path: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });
  // Opening a file from the README reveals it in the tree.
  const shown = open ? new Set([...expanded, ...open.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/"))]) : expanded;

  const render = (nodes: Node[], depth: number): React.ReactNode =>
    nodes.map((n) => {
      const isOpen = n.children && shown.has(n.path);
      return (
        <li key={n.path}>
          <button
            type="button"
            onClick={() => (n.children ? toggle(n.path) : onOpen(n.path))}
            title={n.children ? n.path : `${n.path} · ${n.size.toLocaleString()} B`}
            style={{ paddingLeft: 8 + depth * 12 }}
            className={cn(
              "flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left text-xs transition-colors",
              open === n.path ? "bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {n.children ? (
              <>
                <ChevronRight className={cn("size-3 shrink-0 transition-transform", isOpen && "rotate-90")} />
                {isOpen ? <FolderOpen className="size-3.5 shrink-0" /> : <Folder className="size-3.5 shrink-0" />}
              </>
            ) : (
              <>
                <span className="size-3 shrink-0" />
                {MARKDOWN.test(n.name) ? <BookOpen className="size-3.5 shrink-0" /> : <File className="size-3.5 shrink-0" />}
              </>
            )}
            <span className="truncate font-mono">{n.name}</span>
          </button>
          {isOpen && <ul>{render(n.children!, depth + 1)}</ul>}
        </li>
      );
    });

  return <ul className="min-h-0 overflow-y-auto p-1.5">{render(tree, 0)}</ul>;
}

// Relative links in the README open in the file browser; relative images load from GitHub.
function Readme({
  text,
  base,
  paths,
  raw,
  blob,
  show,
}: {
  text: string;
  base: string;
  paths: Set<string>;
  raw: (p: string) => string;
  blob: (p: string) => string;
  show: (p: string) => void;
}) {
  const resolve = (href: string): string | null => {
    if (/^([a-z][\w+.-]*:|\/\/|#)/i.test(href)) return null;
    let clean = href.split(/[?#]/)[0];
    try {
      clean = decodeURI(clean);
    } catch {}
    const out = clean.startsWith("/") ? [] : base.split("/").slice(0, -1);
    for (const seg of clean.split("/")) {
      if (seg === "..") out.pop();
      else if (seg && seg !== ".") out.push(seg);
    }
    return out.join("/");
  };

  const components: Components = {
    h1: ({ children }) => <h1 className="mt-6 border-b pb-2 text-2xl font-semibold tracking-tight first:mt-0">{children}</h1>,
    h2: ({ children }) => <h2 className="mt-6 border-b pb-1.5 text-xl font-semibold tracking-tight first:mt-0">{children}</h2>,
    h3: ({ children }) => <h3 className="mt-5 text-base font-semibold first:mt-0">{children}</h3>,
    h4: ({ children }) => <h4 className="mt-4 text-sm font-semibold first:mt-0">{children}</h4>,
    p: ({ children }) => <p className="mt-3 first:mt-0">{children}</p>,
    ul: ({ children }) => <ul className="mt-3 list-disc space-y-1 ps-6">{children}</ul>,
    ol: ({ children }) => <ol className="mt-3 list-decimal space-y-1 ps-6">{children}</ol>,
    blockquote: ({ children }) => <blockquote className="mt-3 border-l-4 ps-4 text-muted-foreground">{children}</blockquote>,
    hr: () => <hr className="my-6" />,
    pre: ({ children }) => <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed [&_code]:bg-transparent [&_code]:p-0">{children}</pre>,
    code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>,
    table: ({ children }) => (
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:bg-muted/50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left">{children}</table>
      </div>
    ),
    a: ({ href = "", children }) => {
      const path = resolve(href);
      if (path !== null && paths.has(path)) {
        return (
          <button type="button" onClick={() => show(path)} className="font-medium underline underline-offset-4">
            {children}
          </button>
        );
      }
      return (
        <a href={path !== null ? blob(path) : href} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">
          {children}
        </a>
      );
    },
    img: ({ src, alt }) => {
      if (typeof src !== "string" || !src) return null;
      const path = resolve(src);
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={path !== null ? raw(path) : src} alt={alt ?? ""} className="inline max-w-full" />;
    },
  };

  return (
    <div className="text-sm leading-relaxed break-words">
      {/* READMEs lean on inline HTML; it's parsed, then cut down to GitHub's safe subset. */}
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={components}>
        {text}
      </Markdown>
    </div>
  );
}
