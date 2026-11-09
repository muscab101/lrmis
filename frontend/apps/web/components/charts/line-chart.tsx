"use client";

import { useFormatter } from "next-intl";
import { useId, useRef, useState } from "react";

/**
 * The one chart look of the system (same as the dashboard's Revenue chart): the first series a filled line, the second
 * a dashed line, more series plain lines; dashed grid, few labels, and a hover read-out. Values come already formatted
 * (`shown`) so server pages can use their own number format.
 */
export type ChartPoint = {
  /** Short label under the chart (e.g. "Oct 11"). */
  label: string;
  /** Longer label in the hover box (e.g. "Oct 11, 2026"); defaults to `label`. */
  long?: string;
  values: number[];
  /** Each value as text for the hover box. */
  shown: string[];
};

const COLOURS = ["var(--color-primary)", "var(--color-accent)", "var(--color-status-approved)", "var(--color-status-pending)", "var(--color-status-rejected)"];

export function LineChart({
  points,
  series,
  label,
  legend = true,
}: {
  points: ChartPoint[];
  series: { label: string }[];
  label: string;
  /** Show the series names under the chart (off when the page shows them itself). */
  legend?: boolean;
}) {
  const format = useFormatter();
  const gid = useId().replace(/:/g, "");
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 220;
  const pad = { l: 44, r: 16, t: 12, b: 26 };
  const max = Math.max(1, ...points.flatMap((p) => p.values));
  const nice = (() => {
    const pow = 10 ** Math.floor(Math.log10(max));
    const step = [1, 2, 2.5, 5, 10].map((s) => s * pow).find((s) => max / s <= 4) ?? pow * 10;
    return Math.ceil(max / step) * step;
  })();
  // One point sits in the middle; more spread from edge to edge.
  const n = points.length - 1;
  const x = (i: number) => (n > 0 ? pad.l + (i / n) * (W - pad.l - pad.r) : (pad.l + W - pad.r) / 2);
  const y = (v: number) => pad.t + (1 - Math.max(0, v) / nice) * (H - pad.t - pad.b);
  const path = (s: number) => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.values[s] ?? 0).toFixed(1)}`).join(" ");
  const area = points.length > 1 ? `${path(0)} L${x(n).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z` : "";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => nice * f);
  // Every label when there are few points, else first, middle and last.
  const xTicks = points.length <= 8 ? points.map((_, i) => i) : [0, Math.floor(n / 2), n];
  const dots = points.length <= 12;
  const p = hover !== null ? points[hover] : null;

  return (
    <figure className="space-y-2">
      <div className="relative">
        <svg
          ref={ref}
          viewBox={`0 0 ${W} ${H}`}
          className="h-56 w-full touch-none select-none"
          role="img"
          aria-label={label}
          onPointerMove={(e) => {
            const r = ref.current?.getBoundingClientRect();
            if (!r || !points.length) return;
            const px = ((e.clientX - r.left) / r.width) * W;
            setHover(n > 0 ? Math.max(0, Math.min(n, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * n))) : 0);
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
            <text
              key={i}
              x={x(i)}
              y={H - 6}
              textAnchor={points.length > 1 && k === 0 ? "start" : points.length > 1 && k === xTicks.length - 1 ? "end" : "middle"}
              className="fill-muted-foreground text-[10px]"
            >
              {points[i]!.label}
            </text>
          ))}
          {area && <path d={area} fill={`url(#g${gid})`} />}
          {series
            .map((_, s) => s)
            .reverse()
            .map((s) => (
              <path
                key={s}
                d={path(s)}
                fill="none"
                stroke={COLOURS[s % COLOURS.length]}
                strokeWidth={s === 0 ? 2.5 : 2}
                strokeDasharray={s === 1 ? "5 5" : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          {dots &&
            points.map((pt, i) =>
              series.map((_, s) => (
                <circle key={`${i}-${s}`} cx={x(i)} cy={y(pt.values[s] ?? 0)} r="3" fill={COLOURS[s % COLOURS.length]} />
              )),
            )}
          {hover !== null && p && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={y(0)} stroke="var(--color-muted-foreground)" strokeDasharray="3 3" />
              {series.map((_, s) => (
                <circle
                  key={s}
                  cx={x(hover)}
                  cy={y(p.values[s] ?? 0)}
                  r={s === 0 ? 5 : 4}
                  fill="var(--color-card)"
                  stroke={COLOURS[s % COLOURS.length]}
                  strokeWidth={s === 0 ? 2.5 : 2}
                />
              ))}
            </g>
          )}
        </svg>
        {hover !== null && p && (
          <div
            className="bg-popover pointer-events-none absolute top-1 z-10 min-w-40 -translate-x-1/2 rounded-lg border px-3 py-2 text-xs shadow-sm"
            style={{ left: `${Math.min(85, Math.max(15, (x(hover) / W) * 100))}%` }}
          >
            <p className="mb-1 font-medium">{p.long ?? p.label}</p>
            {series.map((s, i) => (
              <p key={s.label} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: COLOURS[i % COLOURS.length] }} />
                  {s.label}
                </span>
                <span className={`tabular-nums ${i === 0 ? "font-semibold" : ""}`}>{p.shown[i]}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      {legend && (
        <figcaption className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {series.map((s, i) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-0 w-4 border-t-2"
                style={{ borderColor: COLOURS[i % COLOURS.length], borderStyle: i === 1 ? "dashed" : "solid" }}
              />
              {s.label}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}
