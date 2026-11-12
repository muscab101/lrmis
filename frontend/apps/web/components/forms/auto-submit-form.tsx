"use client";

import { useRef } from "react";

/**
 * A filter form that shows the result as soon as a choice changes: no Apply button to press. Lists and dates update at
 * once; typed text waits until typing stops (or Enter).
 */
export function AutoSubmitForm({ className, children }: { className?: string; children: React.ReactNode }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <form
      className={className}
      onChange={(e) => {
        const form = e.currentTarget;
        const el = e.target as unknown as HTMLInputElement;
        if (timer.current) clearTimeout(timer.current);
        const typed = el.tagName === "INPUT" && ["text", "search", "tel", "email", "number", ""].includes(el.type);
        if (typed) timer.current = setTimeout(() => form.requestSubmit(), 700);
        else form.requestSubmit();
      }}
    >
      {children}
    </form>
  );
}
