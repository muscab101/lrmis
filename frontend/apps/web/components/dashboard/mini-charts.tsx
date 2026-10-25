import { cn } from "@dhulka/ui/lib/cn";

/** Seven bars, the busiest day highlighted with its count. */
export function WeekdayBars({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(...values, 0);
  const top = max > 0 ? values.indexOf(max) : -1;
  return (
    <div
      className="flex h-44 items-end gap-2"
      role="img"
      aria-label={labels.map((l, i) => `${l} ${values[i]}`).join(", ")}
    >
      {values.map((v, i) => (
        <div
          key={labels[i]}
          className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
        >
          {i === top && <span className="text-xs font-semibold tabular-nums">{v}</span>}
          <div
            className={cn(
              "w-full max-w-9 rounded-md transition-all",
              i === top ? "bg-primary" : "bg-muted",
            )}
            style={{ height: `${max ? Math.max(8, (v / max) * 100) : 8}%` }}
          />
          <span
            className={cn(
              "text-[11px]",
              i === top ? "text-foreground font-medium" : "text-muted-foreground",
            )}
          >
            {labels[i]}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A half-circle of ticks filled up to `pct` (0–100). */
export function Gauge({
  pct,
  label,
  caption,
}: {
  pct: number | null;
  label: string;
  caption: string;
}) {
  const ticks = 30;
  const filled = pct === null ? 0 : Math.round((Math.min(100, Math.max(0, pct)) / 100) * ticks);
  return (
    <div className="mx-auto w-full max-w-64">
      <div className="relative">
        <svg
          viewBox="0 0 200 110"
          className="w-full"
          role="img"
          aria-label={`${label}: ${pct ?? "—"}%`}
        >
          {Array.from({ length: ticks }, (_, i) => {
            const a = Math.PI - (i / (ticks - 1)) * Math.PI;
            const r1 = 70;
            const r2 = 92;
            return (
              <line
                key={i}
                x1={100 + r1 * Math.cos(a)}
                y1={100 - r1 * Math.sin(a)}
                x2={100 + r2 * Math.cos(a)}
                y2={100 - r2 * Math.sin(a)}
                stroke={i < filled ? "var(--color-success)" : "var(--color-border)"}
                strokeWidth="6"
                strokeLinecap="round"
              />
            );
          })}
        </svg>
        {/* The figure sits inside the arc; the caption goes below it, clear of the ticks. */}
        <p className="absolute inset-x-0 bottom-[6%] text-center text-3xl font-semibold tabular-nums">
          {pct === null ? "—" : `${pct}%`}
        </p>
      </div>
      <p className="text-muted-foreground mt-2 text-center text-xs">{caption}</p>
    </div>
  );
}

/** Coloured bars that share 100 %: one per fee type, with its amount. */
export function SplitBars({
  items,
}: {
  items: { label: string; value: string; share: number; color: string }[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <p className="flex items-center gap-1.5 text-lg font-semibold tabular-nums">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: it.color }} />
            {it.value}
          </p>
          <p className="text-muted-foreground truncate text-xs">{it.label}</p>
          <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(2, it.share)}%`, background: it.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
