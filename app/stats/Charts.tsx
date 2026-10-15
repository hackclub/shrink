"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  DitherGradient,
  Grid,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
  type ChartConfig,
  type DitherColor,
} from "@/components/dither-kit";
import { hm } from "@/lib/program";

const int = (v: number) => Math.round(v).toLocaleString();
// Small counts get fractional ticks; only label the whole numbers.
const whole = (v: number) => (Number.isInteger(v) ? int(v) : "");
const TOP = 28; // room for the legend above the plot
const hours = (v: number) => (v >= 3600 ? `${(v / 3600).toFixed(v >= 36_000 ? 0 : 1)}h` : `${Math.round(v / 60)}m`);

function Frame({ children, className = "h-64" }: { children: React.ReactNode; className?: string }) {
  return <div className={`w-full ${className}`}>{children}</div>;
}

// ---- daily active people ----------------------------------------------------------------------

export type DauPoint = { day: string; label: string; coding: number; shrink: number };

const DAU: ChartConfig = {
  coding: { label: "on Hackatime", color: "blue" },
  shrink: { label: "on a SHRINK project", color: "orange" },
};

export function DauChart({ data }: { data: DauPoint[] }) {
  return (
    <Frame>
      <AreaChart data={data} config={DAU} bloom="low" margins={{ left: 28, top: TOP }}>
        <Grid />
        <XAxis dataKey="label" />
        <YAxis tickFormatter={whole} tickCount={4} />
        <Area dataKey="coding" variant="dotted" />
        <Area dataKey="shrink" variant="gradient" />
        <Tooltip labelKey="label" valueFormatter={(v) => `${int(v)} people`} variant="frosted-glass" />
        <Legend align="left" />
      </AreaChart>
    </Frame>
  );
}

// ---- hours logged per day ---------------------------------------------------------------------

export type HoursPoint = { day: string; label: string; html: number; other: number };

const HOURS: ChartConfig = {
  html: { label: "SHRINK", color: "orange" },
  other: { label: "other", color: "grey" },
};

export function HoursChart({ data }: { data: HoursPoint[] }) {
  return (
    <Frame>
      <BarChart data={data} config={HOURS} stackType="stacked" bloom="low" margins={{ left: 36, top: TOP }}>
        <Grid />
        <XAxis dataKey="label" />
        <YAxis tickFormatter={hours} tickCount={4} />
        <Bar dataKey="other" variant="hatched" />
        <Bar dataKey="html" variant="gradient" />
        <Tooltip labelKey="label" valueFormatter={(v) => hm(v)} variant="frosted-glass" />
        <Legend align="left" />
      </BarChart>
    </Frame>
  );
}

// ---- sign-ups and ships per day ---------------------------------------------------------------

export type FlowPoint = { day: string; label: string; signups: number; ships: number; approved: number };

const FLOW: ChartConfig = {
  signups: { label: "signed up", color: "blue" },
  ships: { label: "shipped", color: "orange" },
  approved: { label: "approved", color: "green" },
};

export function FlowChart({ data }: { data: FlowPoint[] }) {
  return (
    <Frame>
      <BarChart data={data} config={FLOW} bloom="low" margins={{ left: 28, top: TOP }}>
        <Grid />
        <XAxis dataKey="label" />
        <YAxis tickFormatter={whole} tickCount={4} />
        <Bar dataKey="signups" variant="dotted" />
        <Bar dataKey="ships" variant="gradient" />
        <Bar dataKey="approved" variant="solid" />
        <Tooltip labelKey="label" valueFormatter={(v) => int(v)} variant="frosted-glass" />
        <Legend align="left" />
      </BarChart>
    </Frame>
  );
}

// ---- review calls per day --------------------------------------------------------------------

export type ReviewPoint = { day: string; label: string; approved: number; sentBack: number };

const REVIEWS: ChartConfig = {
  approved: { label: "approved", color: "green" },
  sentBack: { label: "sent back", color: "orange" },
};

export function ReviewChart({ data }: { data: ReviewPoint[] }) {
  return (
    <Frame>
      <BarChart data={data} config={REVIEWS} stackType="stacked" bloom="low" margins={{ left: 28, top: TOP }}>
        <Grid />
        <XAxis dataKey="label" />
        <YAxis tickFormatter={whole} tickCount={4} />
        <Bar dataKey="approved" variant="gradient" />
        <Bar dataKey="sentBack" variant="hatched" />
        <Tooltip labelKey="label" valueFormatter={(v) => int(v)} variant="frosted-glass" />
        <Legend align="left" />
      </BarChart>
    </Frame>
  );
}

// ---- decoration -------------------------------------------------------------------------------

export function Glow({ color = "orange", className = "" }: { color?: DitherColor; className?: string }) {
  return <DitherGradient from={color} direction="down" cell={4} opacity={0.22} className={className} />;
}

// ---- funnel -----------------------------------------------------------------------------------

export type FunnelStep = { label: string; value: number; color: DitherColor };

// A horizontal funnel, left to right, drawn to scale: each step's height is
// its share of the top step, and a step of zero is a hairline, not a bar. Each
// segment tapers from this step's height to the next one's so the drop-off is
// the shape itself. Numbers and conversion from the previous step sit above.
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const top = Math.max(1, ...steps.map((s) => s.value));
  const height = (v: number) => (v / top) * 100;
  return (
    <ol className="grid gap-x-1" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((s, i) => {
        const prev = steps[i - 1];
        const next = steps[i + 1];
        const h0 = height(s.value);
        const h1 = next ? height(next.value) : h0;
        const t0 = (100 - h0) / 2;
        const t1 = (100 - h1) / 2;
        const clip = `polygon(0 ${t0}%, 100% ${t1}%, 100% ${100 - t1}%, 0 ${100 - t0}%)`;
        const ratio = prev && prev.value > 0 ? s.value / prev.value : null;
        const drop = ratio == null ? "\u00a0" : ratio > 0 && ratio < 0.005 ? "<1% of prev" : `${Math.round(ratio * 100)}% of prev`;
        return (
          <li key={s.label} className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 flex-col">
              <span className="font-pixel text-[clamp(1.1rem,2.4vw,1.75rem)] leading-none tabular-nums text-white">{s.value.toLocaleString()}</span>
              <span className="mt-1 truncate text-[0.8rem] font-semibold tracking-tight sm:text-[0.9rem]">{s.label}</span>
              <span className="font-mono text-[0.65rem] text-white/45 sm:text-xs">{drop}</span>
            </div>
            <div className="relative h-32 sm:h-44" aria-hidden>
              {/* hairline centre so a zero step still shows where the funnel goes */}
              <div className="absolute inset-x-0 top-1/2 h-px bg-white/15" />
              <div className="absolute inset-0" style={{ clipPath: clip }}>
                <DitherGradient from={s.color} to="transparent" direction="right" cell={3} opacity={0.95} />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
