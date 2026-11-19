"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const EVERY_MS = 30_000;

/**
 * Keeps the dashboard's figures up to date: the page is fetched again every 30 seconds while it is on screen, and at
 * once when the person comes back to the tab. Shows when the figures were last read.
 */
export function LiveRefresh({ label }: { label: string }) {
  const router = useRouter();

  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      last = Date.now();
      router.refresh();
    };
    const timer = window.setInterval(refresh, EVERY_MS);
    const onBack = () => {
      if (document.visibilityState === "visible" && Date.now() - last > 5_000) refresh();
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, [router]);

  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs" aria-live="polite">
      <span className="relative flex size-2" aria-hidden>
        <span className="bg-success absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:animate-none" />
        <span className="bg-success relative inline-flex size-2 rounded-full" />
      </span>
      {label}
    </span>
  );
}
