"use client";

import { useFormatter } from "next-intl";
import { useId, useRef, useState } from "react";

type Point = { day: string; collected: number; billed: number };

/** Collected (filled line) against billed (dashed line), day by day, with a hover read-out. */
export function TrendChart({ series, labels }: { series: Point[]; labels: { collected: string; billed: string } }) {
  const format = useFormatter();
  const gid = useId().replace(/:/g, "");
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 220;
  const pad = { l: 44, r: 12, t: 12, b: 26 };
  const max = Math.max(1, ...series.map((p) => Math.max(p.collected, p.billed)));
  const nice = (() => {
    const pow = 10 ** Math.floor(Math.log10(max));
    const step = [1, 2, 2.5, 5, 10].map((s) => s * pow).find((s) => max / s <= 4) ?? pow * 10;
    return Math.ceil(max / step) * step;
  })();
  const n = Math.max(series.length - 1, 1);
  const x = (i: number) => pad.l + (i / n) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / nice) * (H - pad.t - pad.b);
  const path = (key: "collected" | "billed") => series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const area = `${path("collected")} L${x(series.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const money = (v: number) => format.number(v, { style: "currency", currency: "USD", notation: v >= 10000 ? "compact" : "standard", maximumFractionDigits: 0 });
  const day = (d: string, long = false) => format.dateTime(new Date(`${d}T00:00:00`), long ? { dateStyle: "medium" } : { day: "numeric", month: "short" });
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => nice * f);
  const xTicks = series.length ? [0, Math.floor((series.length - 1) / 2), series.length - 1] : [];
  const p = hover !== null ? series[hover] : null;

  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="h-56 w-full touch-none select-none"
        role="img"
        aria-label={`${labels.collected} / ${labels.billed}`}
        onPointerMove={(e) => {
          const r = ref.current?.getBoundingClientRect();
          if (!r || !series.length) return;
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(series.length - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * n))));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`g${gid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--color-border)" strokeDasharray={v ? "3 4" : undefined} />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {format.number(v, { notation: "compact", maximumFractionDigits: 1 })}
            </text>
          </g>
        ))}
        {xTicks.map((i, k) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"} className="fill-muted-foreground text-[10px]">
            {day(series[i]!.day)}
          </text>
        ))}
        <path d={area} fill={`url(#g${gid})`} />
        <path d={path("billed")} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeDasharray="5 5" strokeLinejoin="round" />
        <path d={path("collected")} fill="none" stroke="var(--color-primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && p && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={y(0)} stroke="var(--color-muted-foreground)" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(p.billed)} r="4" fill="var(--color-card)" stroke="var(--color-accent)" strokeWidth="2" />
            <circle cx={x(hover)} cy={y(p.collected)} r="5" fill="var(--color-card)" stroke="var(--color-primary)" strokeWidth="2.5" />
          </g>
        )}
      </svg>
      {hover !== null && p && (
        <div
          className="bg-popover pointer-events-none absolute top-1 z-10 min-w-40 -translate-x-1/2 rounded-lg border px-3 py-2 text-xs shadow-sm"
          style={{ left: `${(x(hover) / W) * 100}%` }}
        >
          <p className="mb-1 font-medium">{day(p.day, true)}</p>
          <p className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5">
              <span className="bg-primary size-2 rounded-full" />
              {labels.collected}
            </span>
            <span className="font-semibold tabular-nums">{money(p.collected)}</span>
          </p>
          <p className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5">
              <span className="bg-accent size-2 rounded-full" />
              {labels.billed}
            </span>
            <span className="tabular-nums">{money(p.billed)}</span>
          </p>
        </div>
      )}
    </div>
  );
}
