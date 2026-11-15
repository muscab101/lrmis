import * as React from "react";
import { cn } from "../lib/cn";

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom text-sm tabular", className)} {...props} />
    </div>
  );
}
export function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("[&_tr]:border-b [&_tr]:border-foreground/10", className)} {...props} />;
}
/** Glass stripes: rows alternate a see-through white and clear, so the page shows through like the rest of the site; the
 * hovered row turns a soft blue. Also for hand-built tables: put it on their <tbody>. */
export const zebraRows =
  "[&>tr:nth-child(odd)]:bg-white/45 [&>tr:nth-child(even)]:bg-white/10 dark:[&>tr:nth-child(odd)]:bg-white/[0.04] dark:[&>tr:nth-child(even)]:bg-transparent [&>tr:hover]:bg-primary-soft/70 dark:[&>tr:hover]:bg-primary-soft/50";

export function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      className={cn(
        "[&_tr:last-child]:border-0",
        zebraRows,
        className,
      )}
      {...props}
    />
  );
}
export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b border-foreground/[0.06] transition-colors hover:bg-surface/70 data-[state=selected]:bg-primary-soft", className)} {...props} />;
}
export function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn("label-caps h-10 px-3 text-start align-middle whitespace-nowrap text-muted-foreground", className)}
      {...props}
    />
  );
}
export function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-3 py-2.5 align-middle", className)} {...props} />;
}
