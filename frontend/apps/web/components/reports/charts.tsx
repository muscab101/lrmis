/** Small dependency-free charts (server-rendered SVG, theme colours via CSS variables). */
import { LineChart } from "@/components/charts/line-chart";

const SERIES = ["var(--color-primary)", "var(--color-status-rejected)", "var(--color-status-approved)", "var(--color-status-pending)", "var(--color-status-partial)", "var(--color-muted-foreground)"];

export function Legend({ items }: { items: { label: string; color?: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((it, i) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: it.color ?? SERIES[i % SERIES.length] }} aria-hidden />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** Two or more series per category (e.g. money in vs money out per month), in the system's one chart look. */
export function GroupedBars({
  categories,
  series,
  format,
  label,
}: {
  categories: string[];
  series: { label: string; values: number[]; color?: string }[];
  format: (n: number) => string;
  label: string;
  height?: number;
}) {
  return (
    <LineChart
      label={label}
      series={series.map((s) => ({ label: s.label }))}
      points={categories.map((c, i) => ({
        label: c,
        values: series.map((s) => s.values[i] ?? 0),
        shown: series.map((s) => format(s.values[i] ?? 0)),
      }))}
    />
  );
}

export function HBars({ data, format, label, empty }: { data: { label: string; value: number; href?: string }[]; format: (n: number) => string; label: string; empty?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0) return <p className="text-sm text-muted-foreground">{empty ?? "—"}</p>;
  return (
    <ul aria-label={label} className="space-y-2.5">
      {data.map((d) => (
        <li key={d.label} className="text-sm">
          <div className="mb-1 flex justify-between gap-3">
            {d.href ? (
              <a href={d.href} className="truncate hover:text-primary">
                {d.label}
              </a>
            ) : (
              <span className="truncate">{d.label}</span>
            )}
            <span className="shrink-0 font-mono text-xs tabular-nums">{format(d.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div className="h-2 rounded-full bg-primary/80" style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Share of a whole (e.g. revenue by fee type). */
export function Donut({ data, format, label, center }: { data: { label: string; value: number }[]; format: (n: number) => string; label: string; center?: string }) {
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
  const R = 15.9155; // circumference 100
  let offset = 25;
  return (
    <figure aria-label={label} className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 42 42" className="size-36 shrink-0" role="img">
        <title>{label}</title>
        <circle cx={21} cy={21} r={R} fill="none" className="stroke-muted" strokeWidth={5} />
        {total > 0 &&
          data.map((d, i) => {
            const pct = (Math.max(0, d.value) / total) * 100;
            const el = (
              <circle key={d.label} cx={21} cy={21} r={R} fill="none" strokeWidth={5} strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={offset} style={{ stroke: SERIES[i % SERIES.length] }}>
                <title>{`${d.label}: ${format(d.value)} (${Math.round(pct)}%)`}</title>
              </circle>
            );
            offset -= pct;
            return el;
          })}
        {center && (
          <text x={21} y={22.5} textAnchor="middle" className="fill-foreground" style={{ fontSize: 4.2, fontWeight: 600 }}>
            {center}
          </text>
        )}
      </svg>
      <ul className="min-w-40 flex-1 space-y-1.5 text-sm">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 truncate">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} aria-hidden />
              {d.label}
            </span>
            <span className="font-mono text-xs tabular-nums">{format(d.value)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
