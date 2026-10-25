import { cn } from "@dhulka/ui/lib/cn";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

/** Change against the previous period as a % (null when there's nothing to compare with). */
export function change(cur: number, prev: number): number | null {
  if (!prev) return cur ? null : 0;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

export function DeltaPill({ pct, newLabel, className }: { pct: number | null; newLabel: string; className?: string }) {
  const up = pct !== null && pct > 0;
  const down = pct !== null && pct < 0;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
        up ? "bg-success/10 text-success" : down ? "bg-danger/10 text-danger" : "bg-muted text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {pct === null ? newLabel : `${Math.abs(pct)}%`}
    </span>
  );
}

/** One headline number: label + icon, the value, and how it compares with the period before. */
export function StatCard({
  label,
  icon,
  value,
  pct,
  previous,
  newLabel,
  tone = "primary",
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  pct: number | null;
  previous: string;
  newLabel: string;
  tone?: "primary" | "accent" | "warning" | "flag";
}) {
  const toneClass = {
    primary: "bg-primary-soft text-primary",
    accent: "bg-accent-soft text-accent",
    warning: "bg-warning/10 text-warning",
    flag: "bg-flag/10 text-flag",
  }[tone];
  return (
    <div className="bg-card rounded-xl border p-4 shadow-xs transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted-foreground text-sm font-medium">{label}</p>
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4", toneClass)}>{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
        <DeltaPill pct={pct} newLabel={newLabel} />
        <span>{previous}</span>
      </p>
    </div>
  );
}
