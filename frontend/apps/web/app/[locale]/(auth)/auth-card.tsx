import type { ReactNode } from "react";

/** Heading + form, sitting directly on the page (no floating card). */
export function AuthCard({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-8 space-y-2">
        <h1 className="text-[28px] leading-tight font-semibold">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}
