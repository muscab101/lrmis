import { cn } from "@dhulka/ui/lib/cn";

/** One look for every page's tabs (a link per tab under the page header). */
export function tabClass(active: boolean, className?: string) {
  return cn(
    "-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 pb-2 text-sm transition-colors",
    active ? "border-flag text-foreground font-medium" : "text-muted-foreground hover:text-foreground border-transparent",
    className,
  );
}

/** The number beside a tab's name (how many are in it). Nothing when there is no number. */
export function TabCount({ n }: { n: number | string | null | undefined }) {
  if (n === null || n === undefined || n === "") return null;
  return <span className="tab-count bg-muted text-muted-foreground rounded-full px-1.5 text-[11px] font-semibold tabular-nums">{n}</span>;
}

/** A small switch of a few choices (e.g. 7 / 30 / 90 days): the box around them, and each choice. */
export const segGroupClass = "bg-card inline-flex w-fit rounded-lg border p-0.5 text-sm";
export function segClass(active: boolean) {
  return cn(
    "inline-flex items-center gap-1.5 rounded-md px-3 py-1 font-medium whitespace-nowrap transition-colors",
    active
      ? "bg-primary text-primary-foreground [&_.tab-count]:bg-white/25 [&_.tab-count]:text-primary-foreground"
      : "text-muted-foreground hover:text-foreground",
  );
}
