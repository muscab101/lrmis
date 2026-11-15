"use client";

import * as React from "react";
import { cn } from "../lib/cn";

/** What a box takes: person names (letters, spaces, ' . -), whole numbers, numbers with a decimal point, or phones. */
export type InputAllow = "letters" | "digits" | "decimal" | "phone";

const FILTER: Record<InputAllow, (v: string) => string> = {
  letters: (v) => v.replace(/[^\p{L}\p{M}\s'.-]/gu, ""),
  digits: (v) => v.replace(/\D/g, ""),
  phone: (v) => v.replace(/[^\d+\s]/g, "").replace(/(?!^)\+/g, ""),
  decimal: (v) => {
    const clean = v.replace(/[^\d.]/g, "");
    const dot = clean.indexOf(".");
    return dot < 0 ? clean : clean.slice(0, dot + 1) + clean.slice(dot + 1).replace(/\./g, "");
  },
};

/**
 * A text box. `allow` keeps out what doesn't belong (typed or pasted): names take only letters, number boxes only
 * digits. Without it, the kind of box decides: a phone box (type="tel") takes digits and "+", a numeric or decimal
 * keyboard box only numbers, and a number box (type="number") never takes letters, signs or "e".
 */
export function Input({
  className,
  type,
  allow,
  onChange,
  onKeyDown,
  ...props
}: React.ComponentProps<"input"> & { allow?: InputAllow }) {
  const rule: InputAllow | undefined =
    allow ??
    (type === "tel" || props.inputMode === "tel" ? "phone" : props.inputMode === "numeric" ? "digits" : props.inputMode === "decimal" ? "decimal" : undefined);
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 py-1 text-sm shadow-[inset_0_1px_0_rgb(0_0_0/0.03)] transition-colors placeholder:text-muted-foreground file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger aria-invalid:outline-danger/20",
        className,
      )}
      onKeyDown={(e) => {
        if (type === "number" && ["e", "E", "+", "-"].includes(e.key)) e.preventDefault();
        onKeyDown?.(e);
      }}
      onChange={(e) => {
        // A number box's value is already a number (or empty): only text boxes are cleaned.
        if (rule && type !== "number") {
          const clean = FILTER[rule](e.target.value);
          if (clean !== e.target.value) e.target.value = clean;
        }
        onChange?.(e);
      }}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-20 w-full rounded-md border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/30 disabled:opacity-50 aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}
