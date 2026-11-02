"use client";

import { Circle } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

const SEND_EVERY_MS = 30_000;
const NEW_RECORDING_EVERY_MS = 30 * 60_000;
const MAX_HELD_EVENTS = 20_000;

type Session = { id: string; seq: number; started: number };

function loadSession(userId: string): Session {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(`dhulka.recording.${userId}`) ?? "null",
    ) as Session | null;
    if (saved?.id) return saved;
  } catch {
    /* storage blocked: start a new one */
  }
  return { id: crypto.randomUUID(), seq: 0, started: Date.now() };
}

function saveSession(userId: string, s: Session) {
  try {
    sessionStorage.setItem(`dhulka.recording.${userId}`, JSON.stringify(s));
  } catch {
    /* storage blocked: a reload starts a new recording */
  }
}

async function gzip(text: string) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

/**
 * Records this person's work in LRMIS, so a super admin can play it back, and shows the sign that says so. Only what
 * happens inside LRMIS is recorded. Passwords are never recorded, nor anything marked rr-block.
 */
export function WorkRecorder({ userId }: { userId: string }) {
  const t = useTranslations("workRecording");
  const pathname = usePathname();
  const pages = useRef<{ path: string; at: string }[]>([]);

  useEffect(() => {
    pages.current.push({
      path: pathname.replace(/^\/(en|so)(?=\/|$)/, "") || "/",
      at: new Date().toISOString(),
    });
  }, [pathname]);

  useEffect(() => {
    let gone = false;
    let stop: (() => void) | undefined;
    let snapshot: (() => void) | undefined;
    let busy = false;
    const events: unknown[] = [];
    let session = loadSession(userId);
    saveSession(userId, session);

    const send = async (leaving = false) => {
      if (busy) return;
      busy = true;
      if (Date.now() - session.started > NEW_RECORDING_EVERY_MS) {
        // Long days become several short recordings, each able to play by itself.
        session = { id: crypto.randomUUID(), seq: 0, started: Date.now() };
        saveSession(userId, session);
        snapshot?.();
      }
      const batch = events.splice(0);
      const opened = pages.current.splice(0);
      try {
        const form = new FormData();
        form.set(
          "meta",
          JSON.stringify({ recording: session.id, seq: session.seq, pages: opened }),
        );
        const file = batch.length ? await gzip(JSON.stringify(batch)) : null;
        if (file) form.set("file", file);
        const res = await fetch("/api/recording", {
          method: "POST",
          body: form,
          keepalive: leaving && (file?.size ?? 0) < 60_000,
        });
        if (!res.ok) throw new Error(String(res.status));
        if (file) {
          session = { ...session, seq: session.seq + 1 };
          saveSession(userId, session);
        }
      } catch {
        // Offline for now: try again with the next batch.
        if (events.length + batch.length <= MAX_HELD_EVENTS) events.unshift(...batch);
        pages.current.unshift(...opened);
      } finally {
        busy = false;
      }
    };

    void import("rrweb").then(({ record }) => {
      if (gone) return;
      stop =
        record({
          emit: (e) => void events.push(e),
          maskInputOptions: { password: true },
          blockClass: "rr-block",
          inlineStylesheet: true,
          slimDOMOptions: "all",
          recordCanvas: false,
          sampling: { mousemove: 500, scroll: 500, input: "last" },
          // A fresh picture of the page now and then, so playback can jump around.
          checkoutEveryNms: 10 * 60_000,
        }) ?? undefined;
      snapshot = () => record.takeFullSnapshot(true);
    });

    const timer = setInterval(() => void send(), SEND_EVERY_MS);
    const first = setTimeout(() => void send(), 5_000);
    const onLeave = () => void send(true);
    window.addEventListener("pagehide", onLeave);
    return () => {
      gone = true;
      clearInterval(timer);
      clearTimeout(first);
      window.removeEventListener("pagehide", onLeave);
      stop?.();
      void send(true);
    };
  }, [userId]);

  return (
    <span
      className="text-muted-foreground absolute end-1 top-1 inline-flex items-center gap-1 text-xs lg:static lg:px-1"
      title={t("signHint")}
    >
      <Circle className="text-danger size-2 fill-current" aria-hidden />
      <span className="hidden lg:inline">{t("sign")}</span>
      <span className="sr-only lg:hidden">{t("sign")}</span>
    </span>
  );
}
