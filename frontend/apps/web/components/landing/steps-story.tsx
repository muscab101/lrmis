"use client";

import { cn } from "@dhulka/ui/lib/cn";
import { useEffect, useRef, useState } from "react";

export interface StoryStep {
  key: string;
  when: string;
  title: string;
  body: string;
  tag: string;
  tagClass: string;
}

/**
 * The registration steps as a story: the section stays pinned while you scroll, and the steps play one after
 * another, each sliding in as the last slides away, with a progress line and a numbered rail. A plain list for
 * reduced motion.
 */
export function StepsStory({ steps }: { steps: StoryStep[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState(0);
  const [still, setStill] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStill(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const room = r.height - window.innerHeight;
      const p = room > 0 ? Math.min(1, Math.max(0, -r.top / room)) : 0;
      setProgress(p);
      setActive(Math.min(steps.length - 1, Math.floor(p * steps.length)));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [steps.length]);

  if (still) {
    return (
      <ol className="mt-12 border-t border-black/10">
        {steps.map((s, i) => (
          <li key={s.key} className="grid grid-cols-[3.5rem_1fr] gap-x-6 border-b border-black/10 py-5">
            <div className="text-sm font-semibold tabular-nums">0{i + 1}</div>
            <div>
              <div className="text-lg font-semibold">{s.title}</div>
              <div className="text-sm text-[#6b7487]">{s.body}</div>
            </div>
          </li>
        ))}
      </ol>
    );
  }

  return (
    // Tall enough to scroll through every step; the inner frame stays pinned meanwhile.
    <div ref={ref} className="relative mt-10" style={{ height: `${steps.length * 70 + 40}vh` }}>
      <div className="sticky top-16 flex h-[calc(100svh-4rem)] items-center">
        <div className="grid w-full items-center gap-10 md:grid-cols-[1fr_16rem]">
          {/* The current step, the others stacked out of sight above and below it. */}
          <div className="relative h-72 sm:h-80">
            {steps.map((s, i) => (
              <div
                key={s.key}
                aria-hidden={i !== active}
                className={cn(
                  "absolute inset-0 flex flex-col justify-center transition-[opacity,translate,filter] duration-700 ease-[cubic-bezier(.2,.7,.2,1)]",
                  i === active ? "translate-y-0 opacity-100 blur-none" : i < active ? "-translate-y-16 opacity-0 blur-sm" : "translate-y-16 opacity-0 blur-sm",
                )}
              >
                <div className="flex items-baseline gap-4">
                  <span className="bg-gradient-to-b from-[#2a55d6] to-[#9db8ff] bg-clip-text text-7xl font-semibold tracking-tight text-transparent tabular-nums sm:text-9xl">
                    0{i + 1}
                  </span>
                  <span className={`w-fit rounded-sm px-2 py-0.5 text-xs font-medium ${s.tagClass}`}>{s.tag}</span>
                </div>
                <h3 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">{s.title}</h3>
                <p className="mt-3 max-w-xl text-base text-[#4a5468] sm:text-lg">{s.body}</p>
                <p className="mt-2 text-sm font-medium text-[#6b7487]">{s.when}</p>
              </div>
            ))}
          </div>

          {/* The rail: every step, the ones done filled in, with a line that grows as you scroll. */}
          <ol className="relative hidden md:block">
            <span aria-hidden className="absolute start-[0.6875rem] top-3 bottom-3 w-0.5 bg-black/10" />
            <span
              aria-hidden
              className="absolute start-[0.6875rem] top-3 w-0.5 bg-[#2a55d6] transition-[height] duration-150"
              style={{ height: `calc((100% - 1.5rem) * ${progress})` }}
            />
            {steps.map((s, i) => (
              <li key={s.key} className="relative flex items-center gap-3 py-2.5">
                <span
                  className={cn(
                    "relative z-10 grid size-6 place-items-center rounded-full border-2 text-[10px] font-semibold transition-all duration-500",
                    i < active && "border-[#2a55d6] bg-[#2a55d6] text-white",
                    i === active && "scale-125 border-[#2a55d6] bg-white text-[#2a55d6] shadow-[0_0_0_6px_rgba(42,85,214,0.15)]",
                    i > active && "border-black/15 bg-white text-[#6b7487]",
                  )}
                >
                  {i + 1}
                </span>
                <span className={cn("text-sm transition-colors duration-500", i === active ? "font-semibold text-[#0b1a3a]" : "text-[#6b7487]")}>{s.title}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
