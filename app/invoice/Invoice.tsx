"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Download } from "lucide-react";

import HackClubFlag from "@/app/components/HackClubFlag";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";

type Work = { hours: number; decisions: number };

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
// Days are "YYYY-MM-DD"; noon UTC keeps them on the same date in every zone.
const long = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
const monthName = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });

export default function Invoice({
  month,
  months,
  issued,
  work,
  rate,
  defaults,
}: {
  month: string;
  months: string[];
  issued: string;
  work: Work;
  rate: number;
  defaults: { name: string; email: string; address: string };
}) {
  const router = useRouter();
  const [name, setName] = useState(defaults.name);
  const [email, setEmail] = useState(defaults.email);
  const [address, setAddress] = useState(defaults.address);

  const total = Math.round(work.hours * rate * 100) / 100;
  const ready = name.trim().length > 0 && work.hours > 0;

  return (
    <div className="flex min-h-screen flex-col bg-muted font-ui print:block print:min-h-0 print:bg-white">
      {/* Letter, edge to edge: the paper below brings its own margins. */}
      <style>{"@page { size: letter; margin: 0; }"}</style>

      <header className="flex flex-wrap items-center gap-3 border-b bg-background px-5 py-3 print:hidden">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/review">
            <ArrowLeft /> Review desk
          </Link>
        </Button>
        <h1 className="font-semibold">Reviewer invoice</h1>
        <select
          value={month}
          onChange={(e) => router.push(`/invoice?month=${e.target.value}`)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="Month"
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {monthName(m)}
            </option>
          ))}
        </select>
        <Button className="ml-auto" size="sm" disabled={!ready} onClick={() => window.print()} title={ready ? undefined : "Needs a name and some hours"}>
          <Download /> Download PDF
        </Button>
      </header>

      <div className="flex flex-1 flex-col gap-6 p-5 lg:flex-row lg:items-start print:block print:p-0">
        <form className="flex w-full shrink-0 flex-col gap-4 rounded-lg border bg-background p-5 lg:sticky lg:top-5 lg:w-96 print:hidden" onSubmit={(e) => e.preventDefault()}>
          <p className="text-sm text-muted-foreground">
            Your review hours for {monthName(month)}. Check the details, then download and submit the PDF on HCB.
          </p>
          <Field label="Legal name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Address">
            <Textarea rows={3} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="If applicable" />
          </Field>
          {work.decisions === 0 && <p className="text-sm text-destructive">You didn&apos;t decide any ships in {monthName(month)}, so there&apos;s nothing to bill.</p>}
        </form>

        <article className="mx-auto aspect-[8.5/11] w-full max-w-[8.5in] shrink-0 bg-white px-[0.8in] py-[0.75in] text-[13px] leading-relaxed text-neutral-900 shadow-lg print:aspect-auto print:h-[11in] print:max-w-none print:shadow-none">
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between gap-8">
              <HackClubFlag className="w-40 [&_.fill-panel-border]:fill-[#ec3750]" />
              <p className="text-3xl font-semibold tracking-tight">Invoice</p>
            </div>

            <div className="mt-12 grid grid-cols-2 gap-8">
              <div>
                <Caption>From</Caption>
                <p className="font-medium">{name || "—"}</p>
                <p>{email}</p>
                {address && <p className="whitespace-pre-line text-neutral-600">{address}</p>}
              </div>
              <div>
                <Caption>Bill to</Caption>
                <p className="font-medium">The Hack Foundation (Hack Club)</p>
                <p>YSWS - Shrink</p>
                <p className="text-neutral-600">212 Battery St #3</p>
                <p className="text-neutral-600">Burlington, VT 05401</p>
              </div>
            </div>

            <dl className="mt-8 grid grid-cols-2 gap-8 border-y border-neutral-200 py-4">
              <Meta term="Issued">{long(issued)}</Meta>
            </dl>

            <table className="mt-8 w-full">
              <thead>
                <tr className="border-b border-neutral-900 text-left text-[11px] tracking-wide text-neutral-500 uppercase">
                  <th className="pb-2 font-medium">Description</th>
                  <th className="pb-2 pl-6 text-right font-medium">Hours</th>
                  <th className="pb-2 pl-6 text-right font-medium">Rate</th>
                  <th className="pb-2 pl-6 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-neutral-200 align-top">
                  <td className="py-3 pr-6">
                    <p className="font-medium">Project review</p>
                    <p className="text-neutral-600">YSWS - Shrink, {monthName(month)}</p>
                  </td>
                  <td className="py-3 pl-6 text-right font-mono tabular-nums">{work.hours.toFixed(2)}</td>
                  <td className="py-3 pl-6 text-right font-mono tabular-nums">{usd.format(rate)}</td>
                  <td className="py-3 pl-6 text-right font-mono tabular-nums">{usd.format(total)}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="pt-4 pr-6 text-right font-medium">
                    Total due (USD)
                  </td>
                  <td className="pt-4 text-right font-mono text-base font-semibold tabular-nums">{usd.format(total)}</td>
                </tr>
              </tfoot>
            </table>

            <div className="mt-10">
              <Caption>Payment</Caption>
              <p>To the payout method on my HCB contractor profile.</p>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="mb-1 text-[11px] font-medium tracking-wide text-neutral-500 uppercase">{children}</p>;
}

function Meta({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium tracking-wide text-neutral-500 uppercase">{term}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
