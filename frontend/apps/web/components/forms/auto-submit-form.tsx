"use client";

/** A filter form that shows the result as soon as a choice changes: no Apply button to press. */
export function AutoSubmitForm({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <form className={className} onChange={(e) => e.currentTarget.requestSubmit()}>
      {children}
    </form>
  );
}
