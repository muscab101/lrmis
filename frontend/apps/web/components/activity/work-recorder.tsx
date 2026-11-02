"use client";

import { Button } from "@dhulka/ui/button";
import { Circle } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  screenFinishAction,
  screenPrepareUploadAction,
  screenRespondAction,
} from "@/app/[locale]/(admin)/admin/activity/actions";
import { createClient } from "@/lib/supabase/client";

const SEND_EVERY_MS = 30_000;
const NEW_RECORDING_EVERY_MS = 30 * 60_000;
const SCREEN_LIMIT_MS = 10 * 60_000;
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
 * Records this person's work in LRMIS, so a super admin can play it back, and shows the sign that says so. Passwords are
 * never recorded, nor anything marked rr-block. Also answers an admin's request for a real screen video, which the
 * browser always asks the person to allow.
 */
export function WorkRecorder({ userId }: { userId: string }) {
  const t = useTranslations("workRecording");
  const pathname = usePathname();
  const pages = useRef<{ path: string; at: string }[]>([]);
  const [request, setRequest] = useState<{ id: string; requester: string | null } | null>(null);
  const [sharing, setSharing] = useState(false);
  const stopSharing = useRef<(() => void) | null>(null);

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
        const data = (await res.json()) as {
          screen: { id: string; requester: string | null } | null;
        };
        if (!gone && data.screen) setRequest((cur) => cur ?? data.screen);
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

  useEffect(() => () => stopSharing.current?.(), []);

  const decline = useCallback(async () => {
    if (!request) return;
    setRequest(null);
    await screenRespondAction({ id: request.id, status: "declined" });
  }, [request]);

  const share = useCallback(async () => {
    if (!request) return;
    const { id } = request;
    setRequest(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
        audio: false,
      });
    } catch {
      await screenRespondAction({ id, status: "declined" });
      return;
    }
    await screenRespondAction({ id, status: "sharing" });
    const type = MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "video/mp4";
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 500_000 });
    const parts: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) parts.push(e.data);
    };
    const limit = setTimeout(
      () => recorder.state !== "inactive" && recorder.stop(),
      SCREEN_LIMIT_MS,
    );
    const finish = () => recorder.state !== "inactive" && recorder.stop();
    stopSharing.current = finish;
    stream.getVideoTracks()[0]?.addEventListener("ended", finish);
    recorder.onstop = async () => {
      clearTimeout(limit);
      stopSharing.current = null;
      stream.getTracks().forEach((track) => track.stop());
      setSharing(false);
      try {
        const blob = new Blob(parts, { type });
        const prep = await screenPrepareUploadAction({
          id,
          ext: type === "video/webm" ? "webm" : "mp4",
        });
        if (!prep.ok) throw new Error("prepare");
        const up = await createClient()
          .storage.from(prep.data.bucket)
          .uploadToSignedUrl(prep.data.path, prep.data.token, blob, { contentType: type });
        if (up.error) throw up.error;
        const done = await screenFinishAction({ id, path: prep.data.path, bytes: blob.size });
        if (!done.ok) throw new Error("finish");
      } catch {
        await screenRespondAction({ id, status: "failed" });
      }
    };
    recorder.start(5_000);
    setSharing(true);
  }, [request]);

  return (
    <>
      <span
        className="text-muted-foreground absolute end-1 top-1 inline-flex items-center gap-1 text-xs xl:static xl:px-1"
        title={t("signHint")}
      >
        <Circle className="text-danger size-2 fill-current" aria-hidden />
        <span className="hidden xl:inline">{t("sign")}</span>
        <span className="sr-only xl:hidden">{t("sign")}</span>
      </span>
      {request && (
        <div
          role="alertdialog"
          aria-label={t("requestTitle")}
          className="bg-card fixed bottom-4 end-4 z-50 w-80 max-w-[calc(100vw-2rem)] space-y-3 rounded-lg border p-4 shadow-lg"
        >
          <p className="font-semibold">{t("requestTitle")}</p>
          <p className="text-muted-foreground text-sm">
            {t("requestBody", { name: request.requester ?? t("anAdmin") })}
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => void decline()}>
              {t("decline")}
            </Button>
            <Button size="sm" onClick={() => void share()}>
              {t("share")}
            </Button>
          </div>
        </div>
      )}
      {sharing && (
        <div
          role="status"
          className="bg-card fixed bottom-4 end-4 z-50 flex items-center gap-3 rounded-lg border p-3 shadow-lg"
        >
          <Circle className="text-danger size-3 fill-current" aria-hidden />
          <span className="text-sm font-medium">{t("sharing")}</span>
          <Button size="sm" variant="outline" onClick={() => stopSharing.current?.()}>
            {t("stop")}
          </Button>
        </div>
      )}
    </>
  );
}
