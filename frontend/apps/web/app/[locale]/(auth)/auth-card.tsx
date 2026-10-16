import type { ReactNode } from "react";

/** Heading + form, sitting directly on the page (no floating card). */
export function AuthCard({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-10 space-y-3">
        <h1 className="text-3xl leading-[1.05] font-medium tracking-[-0.04em] sm:text-4xl lg:text-[42px]">{title}</h1>
        {description && <p className="text-base leading-snug text-muted-foreground sm:text-lg">{description}</p>}
      </div>
      {children}
    </section>
  );
}
