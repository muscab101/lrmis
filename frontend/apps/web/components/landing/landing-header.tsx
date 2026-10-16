"use client";

import { useEffect, useState } from "react";
import { cn } from "@dhulka/ui/lib/cn";

/** Top bar: transparent over the hero, solid once the page scrolls. */
export function LandingHeader({ children }: { children: React.ReactNode }) {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header
      data-solid={solid || undefined}
      className={cn(
        "group/header fixed inset-x-0 top-0 z-30 transition-colors duration-300",
        solid ? "border-b border-black/5 bg-white/90 text-[#0b1a3a] backdrop-blur" : "bg-transparent text-white",
      )}
    >
      {children}
    </header>
  );
}
