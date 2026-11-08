"use client";

import { useEffect, useRef, useState } from "react";
import { clearJustSignedIn } from "@/lib/welcome";

const SHOW_MS = 1800;
const OUT_MS = 800;

/**
 * Right after signing in: the emblem grows in on a soft background and the greeting rises in; then the emblem
 * shrinks and flies to the dashboard's own logo at the top left while everything else fades away.
 * A click or a key skips to the exit. Always in English (owner decision 2026-11-08).
 */
export function WelcomeSplash({ name }: { name: string }) {
  const [phase, setPhase] = useState<"in" | "out" | "gone">("in");
  // The time of day comes from the browser's own clock, so it is read after the first paint.
  const [hour, setHour] = useState<number | null>(null);
  const [flight, setFlight] = useState<string | null>(null);
  const emblem = useRef<HTMLDivElement>(null);
  const first = name.trim().split(/\s+/)[0] ?? "";

  useEffect(() => {
    clearJustSignedIn();
    setHour(new Date().getHours());
    const hold = setTimeout(() => setPhase("out"), SHOW_MS);
    const skip = () => setPhase((p) => (p === "in" ? "out" : p));
    window.addEventListener("keydown", skip, { once: true });
    return () => {
      clearTimeout(hold);
      window.removeEventListener("keydown", skip);
    };
  }, []);

  useEffect(() => {
    if (phase !== "out") return;
    // Where the dashboard's logo is (the side menu); on a phone, the top left corner.
    const from = emblem.current?.getBoundingClientRect();
    const logo = document
      .querySelector<HTMLElement>("[data-brand-logo] img")
      ?.getBoundingClientRect();
    const to = logo && logo.width > 0 ? logo : new DOMRect(16, 16, 32, 32);
    if (from && from.width > 0 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      setFlight(`translate(${dx}px, ${dy}px) scale(${to.width / from.width})`);
    }
    const done = setTimeout(() => setPhase("gone"), OUT_MS);
    return () => clearTimeout(done);
  }, [phase]);

  if (phase === "gone") return null;
  const greeting =
    hour === null
      ? "Welcome"
      : hour < 12
        ? "Good morning"
        : hour < 17
          ? "Good afternoon"
          : "Good evening";
  return (
    <div
      role="status"
      aria-live="polite"
      onClick={() => setPhase("out")}
      className={`welcome-splash fixed inset-0 z-[100] grid cursor-pointer place-items-center ${phase === "out" ? "welcome-out" : ""}`}
    >
      <div aria-hidden className="welcome-bg">
        <span className="welcome-glow welcome-glow-1" />
        <span className="welcome-glow welcome-glow-2" />
        <span className="welcome-rings" />
        <span className="welcome-dots" />
      </div>
      <div className="relative flex flex-col items-center px-6 text-center">
        {/* The emblem flies to the dashboard's logo on the way out. */}
        <div
          ref={emblem}
          className="welcome-flight"
          style={flight ? { transform: flight } : undefined}
        >
          <div className="welcome-emblem relative size-36 overflow-hidden sm:size-40">
            {/* eslint-disable-next-line @next/next/no-img-element -- static emblem, shown before anything else loads */}
            <img src="/brand/banadir-emblem-256.png" alt="" className="size-full object-contain" />
            <span aria-hidden className="welcome-shine" />
          </div>
        </div>
        <div className="welcome-words flex flex-col items-center">
          <p className="welcome-greet mt-6 text-lg font-semibold tracking-tight sm:text-xl">
            {first ? `${greeting}, ${first}` : greeting}
          </p>
          <span aria-hidden className="welcome-rule mt-3 h-0.5 w-12 rounded-full" />
        </div>
      </div>
    </div>
  );
}
