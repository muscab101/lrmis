import { cn } from "../lib/cn";

/**
 * Dhulka mark: a surveyed parcel (offset squares, like a plot on a cadastral map)
 * with the five-pointed star of the Somali flag.
 */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <rect x="1" y="1" width="30" height="30" rx="5" fill="var(--flag)" />
      <path d="M7 9.5 L22.5 7 L25 22.5 L9.5 25 Z" fill="none" stroke="white" strokeOpacity="0.45" strokeWidth="1.4" strokeLinejoin="round" />
      <path
        d="M16 9.2l1.75 4.6 4.9.22-3.83 3.08 1.31 4.74L16 19.12l-4.13 2.72 1.31-4.74-3.83-3.08 4.9-.22z"
        fill="white"
      />
    </svg>
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
