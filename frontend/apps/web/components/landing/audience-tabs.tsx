"use client";

import { useState } from "react";
import { cn } from "@dhulka/ui/lib/cn";

/** Pill tabs with one large statement per audience (like a guest list). */
export function AudienceTabs({ items, label }: { items: { key: string; label: string; text: string }[]; label: string }) {
  const [active, setActive] = useState(items[0]?.key ?? "");
  const current = items.find((i) => i.key === active) ?? items[0];
  return (
    <div>
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-2">
        {items.map((i) => (
          <button
            key={i.key}
            type="button"
            role="tab"
            id={`aud-${i.key}`}
            aria-selected={i.key === active}
            aria-controls="aud-panel"
            onClick={() => setActive(i.key)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm transition-colors",
              i.key === active ? "border-[#2a55d6]/30 bg-[#2a55d6]/10 text-[#1f45b8]" : "border-black/10 text-[#3b4559] hover:border-black/25",
            )}
          >
            {i.label}
          </button>
        ))}
      </div>
      <p id="aud-panel" role="tabpanel" aria-labelledby={`aud-${active}`} className="mt-8 max-w-4xl text-3xl leading-[1.18] font-medium text-balance text-[#8a93a6] sm:text-[44px]">
        {current?.text}
      </p>
    </div>
  );
}
