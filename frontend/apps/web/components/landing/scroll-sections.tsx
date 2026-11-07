"use client";

import { cn } from "@dhulka/ui/lib/cn";
import { useEffect, useRef, useState } from "react";

/** Runs `update` on scroll and resize, once per frame; nothing for reduced motion (returns false then). */
function useScroll(update: () => void, deps: unknown[]) {
  const [still, setStill] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStill(true);
      return;
    }
    let frame = 0;
    const run = () => {
      frame = 0;
      update();
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    run();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return still;
}

export interface FocusItem {
  key: string;
  title: string;
  body: string;
  glyph: React.ReactNode;
}

/**
 * The heading stays pinned on one side while the cards scroll past on the other; the card in the middle of the
 * screen is sharp and full size, the others fade, shrink and blur a little.
 */
export function FocusCards({ heading, items }: { heading: React.ReactNode; items: FocusItem[] }) {
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  useScroll(() => {
    const mid = window.innerHeight / 2;
    for (const el of cards.current) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const d = Math.min(1, Math.abs(r.top + r.height / 2 - mid) / mid);
      el.style.opacity = String(1 - d * 0.75);
      el.style.transform = `scale(${1 - d * 0.12})`;
      el.style.filter = `blur(${(d * 3).toFixed(2)}px)`;
    }
  }, [items.length]);

  return (
    <div className="grid gap-10 md:grid-cols-[1fr_1.15fr]">
      <div className="md:sticky md:top-28 md:h-fit">{heading}</div>
      <div className="space-y-6 md:py-[20vh]">
        {items.map((it, i) => (
          <div
            key={it.key}
            ref={(el) => {
              cards.current[i] = el;
            }}
            className="group rounded-2xl border border-black/5 bg-gradient-to-br from-white to-[#eef3ff] p-8 shadow-[0_20px_50px_-20px_rgba(11,42,143,0.25)] will-change-transform md:min-h-[38vh]"
          >
            <div className="transition-transform duration-500 group-hover:-translate-y-1 group-hover:rotate-[-4deg]">{it.glyph}</div>
            <h3 className="mt-8 text-2xl font-semibold tracking-tight">{it.title}</h3>
            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-[#4a5468]">{it.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One large statement per audience; its words light up one by one as it scrolls up the screen. */
export function ScrollWords({ items }: { items: { key: string; label: string; text: string }[] }) {
  const blocks = useRef<(HTMLDivElement | null)[]>([]);
  const still = useScroll(() => {
    const vh = window.innerHeight;
    for (const el of blocks.current) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      // 0 when the statement's top reaches 85% of the screen, 1 when it reaches 35%.
      const p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (vh * 0.5)));
      const words = el.querySelectorAll<HTMLSpanElement>("[data-word]");
      words.forEach((w, i) => {
        w.style.opacity = i / words.length < p ? "1" : "0.18";
      });
    }
  }, [items.length]);

  return (
    <div className="space-y-14 sm:space-y-20">
      {items.map((it, i) => (
        <div
          key={it.key}
          ref={(el) => {
            blocks.current[i] = el;
          }}
        >
          <p className="mb-3 text-sm font-semibold tracking-wide text-[#2a55d6] uppercase">{it.label}</p>
          <p className="max-w-4xl text-3xl leading-tight font-semibold tracking-tight sm:text-5xl">
            {it.text.split(" ").map((word, k) => (
              <span key={k} data-word className={cn("transition-opacity duration-300", still ? "opacity-100" : "opacity-20")}>
                {word}{" "}
              </span>
            ))}
          </p>
        </div>
      ))}
    </div>
  );
}
