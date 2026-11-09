"use client";

import { TriangleAlert, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const SHOW_MS = 5000;

interface Warning {
  id: string;
  message: string;
  created_at: string;
  district_id: string | null;
}

/**
 * A warning from the admin on every open screen (or only for one district's staff; the database decides who gets it).
 * A big red box in the middle of the screen counts down 5 seconds, then goes away by itself. A page opened in the few
 * seconds after it was sent still shows it.
 */
export function SystemWarning() {
  const t = useTranslations("systemWarning");
  const locale = useLocale();
  const supabase = useMemo(() => createClient(), []);
  const [current, setCurrent] = useState<(Warning & { place: string | null }) | null>(null);
  const [visible, setVisible] = useState(false);
  const [left, setLeft] = useState(5);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    const show = async (w: Warning) => {
      if (seen.current.has(w.id)) return;
      seen.current.add(w.id);
      try {
        sessionStorage.setItem(`warning:${w.id}`, "1");
      } catch {}
      let place: string | null = null;
      if (w.district_id) {
        const { data } = await supabase
          .from("districts")
          .select("name_so, name_en")
          .eq("id", w.district_id)
          .maybeSingle();
        const d = data as { name_so: string; name_en: string } | null;
        place = d ? (locale === "so" ? d.name_so : d.name_en) : null;
      }
      setVisible(false);
      setCurrent({ ...w, place });
    };
    const shownBefore = (id: string) => {
      try {
        return sessionStorage.getItem(`warning:${id}`) === "1";
      } catch {
        return false;
      }
    };
    // Sent just before this page opened (for example while moving between pages).
    void supabase
      .from("system_warnings")
      .select("id, message, created_at, district_id")
      .gt("created_at", new Date(Date.now() - SHOW_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        const w = (data ?? [])[0] as Warning | undefined;
        if (w && !shownBefore(w.id)) void show(w);
      });
    const channel = supabase
      .channel("system-warnings")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "system_warnings" }, (p) =>
        void show(p.new as Warning),
      )
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [supabase, locale]);

  // Slide in, count down, slide out.
  useEffect(() => {
    if (!current) return;
    setLeft(5);
    const enter = requestAnimationFrame(() => setVisible(true));
    const tick = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    const leave = setTimeout(() => setVisible(false), SHOW_MS);
    const gone = setTimeout(() => setCurrent(null), SHOW_MS + 450);
    return () => {
      cancelAnimationFrame(enter);
      clearInterval(tick);
      clearTimeout(leave);
      clearTimeout(gone);
    };
  }, [current]);

  if (!current) return null;
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <div
      className={`fixed inset-0 z-[100] grid place-items-center bg-black/30 p-4 backdrop-blur-[3px] transition-opacity duration-300 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        role="alertdialog"
        aria-live="assertive"
        aria-labelledby="system-warning-title"
        className={`text-foreground dark:bg-card/90 relative w-full max-w-3xl overflow-hidden rounded-sm border border-white/70 bg-white/90 font-sans shadow-2xl backdrop-blur-xl transition-transform duration-300 ease-out dark:border-white/10 ${
          visible ? "scale-100" : "scale-90"
        }`}
      >
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="text-muted-foreground hover:text-foreground absolute end-4 top-4 rounded-md p-1.5"
          aria-label={t("close")}
        >
          <X className="size-5" aria-hidden />
        </button>
        <div className="flex flex-col items-center px-8 pt-10 pb-8 text-center sm:px-14">
          <TriangleAlert className="text-danger size-16 animate-pulse" aria-hidden />
          <p
            id="system-warning-title"
            className="text-danger mt-4 text-sm font-bold tracking-[0.2em]"
          >
            {t("title")} · {current.place ?? t("everyone")}
          </p>
          <p className="mt-4 whitespace-pre-wrap text-3xl font-bold leading-tight sm:text-4xl">
            {current.message}
          </p>
          {/* Seconds left, in a ring that empties. */}
          <div className="text-danger relative mt-8 grid size-14 place-items-center" aria-hidden>
            <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
              <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
              <circle
                cx="18"
                cy="18"
                r={r}
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={c}
                strokeDashoffset={visible ? c : 0}
                style={{ transition: visible ? `stroke-dashoffset ${SHOW_MS}ms linear` : "none" }}
              />
            </svg>
            <span className="text-lg font-bold tabular-nums">{left}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
