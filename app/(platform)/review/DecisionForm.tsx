"use client";

import { AlertCircle, Check, Loader2, Undo2 } from "lucide-react";
import { useActionState, useState } from "react";

import { Alert, AlertDescription } from "@/app/components/ui/alert";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { Textarea } from "@/app/components/ui/textarea";
import { BADGES, BASE_CAP, bitesFor, capFor } from "@/lib/program";

import { decideAction, type DecisionState } from "./actions";

export default function DecisionForm({
  shipId,
  nextId,
  filter,
  claimedSeconds,
  claimedBadges,
  isOwn,
  fraudMessage,
}: {
  shipId: string;
  nextId: string;
  // The desk's secondary-check filter, kept across the redirect to the next ship.
  filter: string;
  claimedSeconds: number;
  claimedBadges: string[];
  isOwn: boolean;
  // Set when the secondary check failed: the only way out is sending it back, with this prefilled.
  fraudMessage?: string;
}) {
  const [state, action, pending] = useActionState<DecisionState, FormData>(decideAction, { error: null });
  const maxHours = Math.round((claimedSeconds / 3600) * 10) / 10;
  const [hours, setHours] = useState(String(maxHours));
  const [badges, setBadges] = useState<Set<string>>(new Set(claimedBadges));
  const [kind, setKind] = useState<"approve" | "reject">(fraudMessage ? "reject" : "approve");

  const h = Number(hours);
  const bites = Number.isFinite(h) && h > 0 ? bitesFor(Math.min(h, maxHours) * 3600, [...badges]) : 0;
  const cap = capFor([...badges]);
  const approving = kind === "approve";

  return (
    <Card className="gap-0 py-0">
      <form action={action}>
        <input type="hidden" name="ship_id" value={shipId} />
        <input type="hidden" name="next_id" value={nextId} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="f" value={filter} />

        <CardHeader className="border-b py-4 [.border-b]:pb-4">
          <CardTitle>{fraudMessage ? "Send back for fraud" : "Decision"}</CardTitle>
          <CardDescription>
            {fraudMessage
              ? "The fraud check failed this one. Read the note, edit the message if needed, and send it back. The author sees it as in review until you do."
              : "Approve with hours and badges, or send it back with what to fix."}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-5 py-5">
          {isOwn && (
            <Alert>
              <AlertCircle />
              <AlertDescription>This is your own ship. Only an admin can decide it.</AlertDescription>
            </Alert>
          )}

          {!fraudMessage && (
            <Tabs value={kind} onValueChange={(v) => setKind(v as "approve" | "reject")}>
              <TabsList className="w-full">
                <TabsTrigger value="approve" className="data-[state=active]:bg-white">
                  <Check />
                  Approve
                </TabsTrigger>
                <TabsTrigger value="reject" className="data-[state=active]:bg-white">
                  <Undo2 />
                  Send back
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          {approving && (
            <>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between">
                    <Label htmlFor="hours">Hours to award</Label>
                    <button
                      type="button"
                      className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      onClick={() => setHours(String(maxHours))}
                    >
                      max {maxHours}h
                    </button>
                  </div>
                  <Input
                    id="hours"
                    name="hours"
                    type="number"
                    step="0.1"
                    min="0.1"
                    max={maxHours}
                    required
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    className="font-mono"
                  />
                </div>
                <div className="rounded-md bg-muted px-3 py-1.5 text-right">
                  <p className="font-mono text-xl leading-tight font-semibold tabular-nums">{bites}</p>
                  <p className="text-xs text-muted-foreground">
                    BITES · cap {cap}
                    {cap > BASE_CAP && ` (${BASE_CAP}+${cap - BASE_CAP})`}
                  </p>
                </div>
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium">Badges earned</legend>
                <div className="grid grid-cols-1 gap-2">
                  {BADGES.map((b) => {
                    const id = `badge-${b.slug}`;
                    return (
                      <Label
                        key={b.slug}
                        htmlFor={id}
                        className="flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 font-normal hover:bg-muted/60 has-[[data-state=checked]]:border-primary"
                      >
                        <Checkbox
                          id={id}
                          name="badge"
                          value={b.slug}
                          checked={badges.has(b.slug)}
                          onCheckedChange={() => {
                            const n = new Set(badges);
                            if (n.has(b.slug)) n.delete(b.slug);
                            else n.add(b.slug);
                            setBadges(n);
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate">{b.title}</span>
                        <span className="font-mono text-xs text-muted-foreground">+{b.bites}</span>
                        {claimedBadges.includes(b.slug) && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[0.65rem] font-medium text-muted-foreground">claimed</span>
                        )}
                      </Label>
                    );
                  })}
                </div>
              </fieldset>
            </>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="message">Message to the author</Label>
            <Textarea
              id="message"
              name="message"
              required
              rows={4}
              maxLength={2000}
              defaultValue={fraudMessage}
            />
            <p className="text-xs text-muted-foreground">They get this in a Slack DM.</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="internal_note">Justification</Label>
            <Textarea id="internal_note" name="internal_note" rows={2} />
          </div>

          {state.error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
        </CardContent>

        <CardFooter className="border-t py-4 [.border-t]:pt-4">
          <Button
            type="submit"
            size="lg"
            disabled={pending || isOwn}
            variant={approving ? "default" : "destructive"}
            className={`w-full ${approving ? "bg-brand text-black hover:bg-brand/85" : ""}`}
          >
            {pending ? <Loader2 className="animate-spin" /> : approving ? <Check /> : <Undo2 />}
            {approving ? `Approve for ${bites} BITES` : "Send it back"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
