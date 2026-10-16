import { cn } from "../lib/cn";

/** Banadir Regional Administration emblem (served from the web app's /brand folder). */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- shared package, plain img keeps it framework-agnostic
    <img
      src="/brand/banadir-emblem-256.png"
      width={32}
      height={33}
      alt={title ?? ""}
      aria-hidden={title ? undefined : true}
      className={cn("size-8 shrink-0 object-contain", className)}
    />
  );
}

export function BrandLockup({ name, sub, className, inverted = false }: { name: string; sub?: string; className?: string; inverted?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <BrandMark />
      <span className="min-w-0 leading-none">
        <span className={cn("block text-[15px] font-semibold tracking-tight", inverted ? "text-ink-foreground" : "text-foreground")}>{name}</span>
        {sub && <span className={cn("mt-1 hidden truncate text-[11px] sm:block", inverted ? "text-ink-foreground/60" : "text-muted-foreground")}>{sub}</span>}
      </span>
    </span>
  );
}
