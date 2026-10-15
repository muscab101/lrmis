import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../lib/cn";

export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-px text-[11.5px] font-medium whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary-soft text-primary",
        outline: "text-foreground",
        accent: "border-transparent bg-accent-soft text-accent",
        muted: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/**
 * Status colours are identical across the product:
 * draft = slate, pending = amber, approved/registered/paid/active = green,
 * rejected/overdue/suspended = red, partial/invited = blue.
 * A dot + text means colour is never the only signal.
 */
export type StatusTone = "draft" | "pending" | "approved" | "rejected" | "partial";

const TONE_CLASSES: Record<StatusTone, string> = {
  draft: "bg-card text-status-draft border-status-draft/30",
  pending: "bg-card text-status-pending border-status-pending/35",
  approved: "bg-card text-status-approved border-status-approved/35",
  rejected: "bg-card text-status-rejected border-status-rejected/35",
  partial: "bg-card text-status-partial border-status-partial/35",
};

export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(badgeVariants(), TONE_CLASSES[tone], className)}>
      <span className="size-1.5 rotate-45 bg-current" aria-hidden />
      {children}
    </span>
  );
}
