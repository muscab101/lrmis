import * as React from "react";
import { cn } from "../lib/cn";
import { Label } from "./label";

interface FieldProps {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  /** Already-translated error message. */
  error?: string | undefined;
  required?: boolean;
  className?: string;
  children: React.ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }>;
}

/**
 * Label + control + hint/error with correct ARIA wiring.
 * In a grid of fields side by side, each field shares the grid's rows (label / control / hint), so the inputs line up
 * even when one label or hint wraps to more lines than its neighbour's. Outside a grid it is a plain column.
 */
export function Field({ id, label, hint, error, required, className, children }: FieldProps) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return (
    <div className={cn("row-span-3 grid grid-rows-subgrid content-start gap-1.5", className)}>
      <Label htmlFor={id} className="self-end">
        {label}
        {required && (
          <span className="text-danger ms-0.5" aria-hidden>
            *
          </span>
        )}
      </Label>
      {React.cloneElement(children, {
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy || undefined,
      })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
