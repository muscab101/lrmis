"use client";

import { cn } from "@dhulka/ui/lib/cn";
import { useEffect, useRef, useState } from "react";

/** How content arrives: lifted, from a side, growing, or coming into focus. */
type Variant = "up" | "left" | "right" | "zoom" | "blur";

const HIDDEN: Record<Variant, string> = {
  up: "translate-y-10 opacity-0",
  left: "-translate-x-12 opacity-0",
  right: "translate-x-12 opacity-0",
  zoom: "scale-75 rotate-[-8deg] opacity-0",
  blur: "translate-y-6 blur-md opacity-0",
};

/** Fades its content in the first time it scrolls into view, in the chosen way. */
export function Reveal({
  children,
  className,
  delay = 0,
  variant = "up",
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  variant?: Variant;
  as?: "div" | "li" | "section";
}) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag
      ref={ref as React.Ref<never>}
      style={{ transitionDelay: shown ? `${delay}ms` : undefined }}
      className={cn(
        "transition-[opacity,translate,scale,rotate,filter] duration-[900ms] ease-[cubic-bezier(.2,.7,.2,1)] motion-reduce:transition-none",
        shown
          ? "translate-x-0 translate-y-0 rotate-0 scale-100 opacity-100 blur-none"
          : cn(
              HIDDEN[variant],
              "motion-reduce:translate-x-0 motion-reduce:translate-y-0 motion-reduce:rotate-0 motion-reduce:scale-100 motion-reduce:opacity-100 motion-reduce:blur-none",
            ),
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/**
 * Gives its content `--p`: how far it has scrolled, 0 when its top meets `from` of the screen and 1 when its bottom
 * meets `to`. Styles read it to move with the scroll (parallax, a line that fills). Stays 0 for reduced motion.
 */
export function ScrollProgress({
  children,
  className,
  from = 1,
  to = 0.5,
  distance,
}: {
  children: React.ReactNode;
  className?: string;
  from?: number;
  to?: number;
  /** Instead: 0 at the top of the page and 1 after scrolling this many pixels (for the hero). */
  distance?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      let p: number;
      if (distance) p = Math.min(1, Math.max(0, window.scrollY / distance));
      else {
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight;
        const start = vh * from;
        const end = vh * to - r.height;
        p = Math.min(1, Math.max(0, (start - r.top) / (start - end)));
      }
      el.style.setProperty("--p", p.toFixed(4));
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
  }, [from, to, distance]);
  return (
    <div ref={ref} className={className} style={{ ["--p" as string]: 0 }}>
      {children}
    </div>
  );
}

/** Counts up to its number the first time it scrolls into view. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    let frame = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const tick = (now: number) => {
        const k = Math.min(1, (now - t0) / 1400);
        setShown(Math.round(value * (1 - (1 - k) ** 3)));
        if (k < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value]);
  return (
    <span ref={ref} className={className}>
      {shown}
    </span>
  );
}
