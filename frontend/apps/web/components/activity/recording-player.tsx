"use client";

import { Button } from "@dhulka/ui/button";
import { Play, Video, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import "rrweb-player/dist/style.css";
import {
  recordingPiecesAction,
  screenLinkAction,
  screenRequestAction,
} from "@/app/[locale]/(admin)/admin/activity/actions";
import { useRouter } from "@/i18n/navigation";
import { FormError } from "@/components/forms/form-error";
import type { AppError } from "@dhulka/core/errors";

async function loadPiece(url: string): Promise<unknown[]> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(String(res.status));
  const text = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).text();
  return JSON.parse(text) as unknown[];
}

/** Plays one recording back, like a video. */
export function RecordingPlayer({ id }: { id: string }) {
  const t = useTranslations("staffActivity");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "short" | "failed">("loading");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let gone = false;
    let player: { $destroy?: () => void } | null = null;
    const target = box.current;
    setState("loading");
    void (async () => {
      try {
        const r = await recordingPiecesAction({ id });
        if (!r.ok) throw new Error(r.error.code);
        // A few at a time: a recording can have many pieces.
        const parts: unknown[][] = [];
        for (let i = 0; i < r.data.length; i += 6) {
          parts.push(...(await Promise.all(r.data.slice(i, i + 6).map(loadPiece))));
        }
        const events = parts.flat() as { timestamp: number }[];
        events.sort((a, b) => a.timestamp - b.timestamp);
        if (gone) return;
        if (events.length < 2) return setState("short");
        const { default: Player } = await import("rrweb-player");
        if (gone || !target) return;
        const width = Math.min(target.clientWidth, 1200);
        player = new Player({
          target,
          props: {
            events: events as never,
            width,
            height: Math.round(width * 0.56),
            autoPlay: true,
            skipInactive: true,
            speedOption: [1, 2, 4, 8],
          },
        }) as unknown as { $destroy?: () => void };
        setState("ready");
      } catch {
        if (!gone) setState("failed");
      }
    })();
    return () => {
      gone = true;
      player?.$destroy?.();
      if (target) target.innerHTML = "";
    };
  }, [open, id]);

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Play aria-hidden />
        {t("watch")}
      </Button>
    );
  }
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col gap-3 overflow-auto bg-black/80 p-4"
      role="dialog"
      aria-label={t("watch")}
    >
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
          <X aria-hidden />
          {t("close")}
        </Button>
      </div>
      {state !== "ready" && (
        <p className="text-center text-sm text-white">
          {state === "loading" ? t("loading") : state === "short" ? t("tooShort") : t("loadFailed")}
        </p>
      )}
      <div ref={box} className="mx-auto w-full max-w-[1200px]" />
    </div>
  );
}

/** Asks the person to share their real screen. The browser asks them to allow it. */
export function ScreenRequestButton({ userId }: { userId: string }) {
  const t = useTranslations("staffActivity");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await screenRequestAction({ userId });
          setBusy(false);
          if (!r.ok) return setError(r.error);
          router.refresh();
        }}
      >
        <Video aria-hidden />
        {t("askScreen")}
      </Button>
      <FormError error={error} />
    </div>
  );
}

export function ScreenVideo({ id }: { id: string }) {
  const t = useTranslations("staffActivity");
  const [url, setUrl] = useState<string | null>(null);
  if (url)
    return (
      <video src={url} controls autoPlay className="mt-2 max-h-[70vh] w-full rounded-md bg-black" />
    );
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        const r = await screenLinkAction({ id });
        if (r.ok) setUrl(r.data);
      }}
    >
      <Play aria-hidden />
      {t("watch")}
    </Button>
  );
}
