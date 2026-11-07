import * as React from "react";
import { cn } from "../lib/cn";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  // Frosted box with a soft light passing over it (see .skeleton in tokens.css).
  return <div aria-hidden className={cn("skeleton rounded-md", className)} {...props} />;
}

export function Separator({ className, vertical = false }: { className?: string; vertical?: boolean }) {
  return (
    <div
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      className={cn("shrink-0 bg-border", vertical ? "h-full w-px" : "h-px w-full", className)}
    />
  );
}

export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-5 items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** Numbers like PUN, receipt and invoice numbers. */
export function Mono({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("font-mono text-[0.92em] tabular", className)} {...props} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 px-6 py-16 text-center", className)}>
      {icon && <div className="text-muted-foreground/70 [&_svg]:size-8 [&_svg]:stroke-[1.25]">{icon}</div>}
      <div className="space-y-1.5">
        <p className="text-[15px] font-semibold">{title}</p>
        {description && <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Figure with a caps label — reads like a line in a ledger rather than a floating chip. */
export function KpiChip({
  label,
  value,
  tone = "default",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const bar = {
    default: "before:bg-foreground/25",
    success: "before:bg-success",
    warning: "before:bg-warning",
    danger: "before:bg-danger",
  }[tone];
  return (
    <div className={cn("relative min-w-32 ps-3 before:absolute before:inset-y-0.5 before:start-0 before:w-0.5", bar)}>
      <div className="label-caps text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl leading-none font-semibold tabular">{value}</div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-7 space-y-5 border-b pb-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          {eyebrow && <div className="label-caps text-flag">{eyebrow}</div>}
          <h1 className="text-[26px] leading-tight font-semibold">{title}</h1>
          {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const toneClass = {
    info: "border-s-info",
    success: "border-s-success",
    warning: "border-s-warning",
    danger: "border-s-danger",
  }[tone];
  const titleClass = { info: "text-info", success: "text-success", warning: "text-warning", danger: "text-danger" }[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("rounded-md border border-s-[3px] bg-card px-4 py-3 text-sm", toneClass, className)}
    >
      {title && <p className={cn("font-semibold", titleClass)}>{title}</p>}
      {children && <div className={cn("text-foreground/75", title && "mt-0.5")}>{children}</div>}
    </div>
  );
}
