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
 * rejected/overdue/suspended = red, partial/invited = blue, paid = deep blue.
 * Shown as plain coloured words (no box, no icon); the word itself says the status, so colour is never the only signal.
 */
export type StatusTone = "draft" | "pending" | "approved" | "rejected" | "partial" | "paid";

const TONE_CLASSES: Record<StatusTone, string> = {
  draft: "text-status-draft",
  pending: "text-status-pending",
  approved: "text-status-approved",
  rejected: "text-status-rejected",
  partial: "text-status-partial",
  paid: "text-status-paid",
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
    <span data-slot="status" className={cn("inline-flex items-center text-xs font-medium whitespace-nowrap", TONE_CLASSES[tone], className)}>
      {children}
    </span>
  );
}
