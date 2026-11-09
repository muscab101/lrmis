"use client";

import { ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

/** How long the certificate stays black after a screenshot key (time to drag a selection on Mac). */
const HOLD_MS = 10_000;

/**
 * Makes screenshots of a certificate come out black. The computer takes the picture, not the page, so the page turns
 * the certificate black the moment a screenshot is starting, before the picture is taken:
 *  · Mac: Cmd+Shift (before 3, 4 or 5), and the screenshot toolbar taking focus;
 *  · Windows: Win+Shift (before S) and the Snipping Tool taking focus; Print Screen also empties the clipboard;
 *  · any time the page is in the background or hidden.
 * The black cover is shown instantly (no fade) and stays while the keys are held and for 10 seconds after, or until
 * the person clicks back on the page. Right-click, dragging and copying are off. Printing is not
 * touched: the cover never prints.
 */
export function ScreenshotShield({ children, off = false }: { children: React.ReactNode; off?: boolean }) {
  const t = useTranslations("documents.shield");
  const [covered, setCovered] = useState(false);
  const until = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Inside the LRMIS desktop app the computer itself keeps the window out of screenshots.
    if (off) return;
    const away = () => !document.hasFocus() || document.visibilityState !== "visible";
    const cover = (ms: number) => {
      until.current = Math.max(until.current, Date.now() + ms);
      setCovered(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (!away()) setCovered(false);
      }, until.current - Date.now());
    };
    const uncoverSoon = () => {
      until.current = 0;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (!away()) setCovered(false);
      }, 300);
    };
    const screenshotKeys = (e: KeyboardEvent) =>
      (e.metaKey && e.shiftKey) ||
      (e.key === "Meta" && e.shiftKey) ||
      (e.key === "Shift" && e.metaKey) ||
      (e.ctrlKey && e.shiftKey && (e.key === "S" || e.key === "s"));
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "PrintScreen" || e.key === "Snapshot") {
        cover(HOLD_MS);
        void navigator.clipboard?.writeText("").catch(() => {});
      } else if (screenshotKeys(e)) cover(HOLD_MS);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      // Windows only reports Print Screen when it is let go: the picture is in the clipboard, so empty it.
      if (e.key === "PrintScreen" || e.key === "Snapshot") {
        cover(HOLD_MS);
        void navigator.clipboard?.writeText("").catch(() => {});
      }
    };
    // A click back on the page shows it again (a screenshot selection is dragged outside the page's reach).
    const onClick = () => {
      if (!away()) uncoverSoon();
    };
    const onBlur = () => cover(24 * 3600_000);
    const onVisible = () => (document.visibilityState === "hidden" ? cover(24 * 3600_000) : undefined);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pointerdown", onClick);
    document.addEventListener("visibilitychange", onVisible);
    if (away()) setCovered(true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerdown", onClick);
      document.removeEventListener("visibilitychange", onVisible);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [off]);

  if (off) return <>{children}</>;
  return (
    <div
      className="relative select-none print:select-auto"
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      onCopy={(e) => e.preventDefault()}
    >
      {children}
      {/* No fade: the cover must be there before the picture is taken. */}
      <div
        aria-hidden={!covered}
        className={`absolute inset-0 z-50 grid place-items-center bg-black text-neutral-500 print:hidden ${
          covered ? "visible" : "invisible"
        }`}
      >
        <div className="flex flex-col items-center gap-2 text-center text-sm">
          <ShieldAlert className="size-8" aria-hidden />
          <p className="font-medium">{t("title")}</p>
          <p className="max-w-xs text-xs text-neutral-600">{t("body")}</p>
        </div>
      </div>
    </div>
  );
}
