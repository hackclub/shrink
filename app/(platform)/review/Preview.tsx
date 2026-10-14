"use client";

import { Check, ChevronDown, Copy, Info, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";

import { AppFrame } from "@/app/components/ui/bits";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";

export default function Preview({ uri, title }: { uri: string; title: string }) {
  const [run, setRun] = useState(0);
  const [copied, setCopied] = useState(false);
  const [showUri, setShowUri] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
    } catch {
      // The URI below is select-all, so they can still grab it by hand.
      setShowUri(true);
    }
  };

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="text-sm font-medium">Preview</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setRun((n) => n + 1)}>
            <RotateCw />
            Restart
          </Button>
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy URI"}
          </Button>
        </div>
      </div>
      <div className="aspect-[4/3] bg-white">
        <AppFrame key={run} uri={uri} title={title} />
      </div>
      <div className="flex items-start gap-2 border-t bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>
          The preview runs sandboxed with no network, so some projects don&rsquo;t work here. If it&rsquo;s blank or broken, copy the URI and paste it
          into a new browser tab&rsquo;s address bar to run it for real.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setShowUri((v) => !v)}
        className="flex w-full items-center justify-between border-t px-3 py-2 text-left text-sm font-medium text-muted-foreground hover:bg-muted/50"
        aria-expanded={showUri}
      >
        Data URI
        <ChevronDown className={`size-4 transition-transform ${showUri ? "rotate-180" : ""}`} />
      </button>
      {showUri && (
        <pre className="max-h-56 overflow-auto border-t bg-muted/30 p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap select-all">{uri}</pre>
      )}
    </Card>
  );
}
