"use client";

import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import "rrweb/dist/style.css";
import {
  liveListAction,
  livePiecesAction,
  type LivePerson,
} from "@/app/[locale]/(admin)/admin/activity/actions";
import {
  SCREEN_EVENT,
  WATCH_EVENT,
  WATCH_EVERY_MS,
  closeLiveChannel,
  openLiveChannel,
  screenAssembler,
  type ScreenPart,
} from "@/lib/live-screen";

const LIST_EVERY_MS = 20_000;

async function loadPiece(url: string): Promise<{ timestamp: number }[]> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(String(res.status));
  const text = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).text();
  return JSON.parse(text) as { timestamp: number }[];
}

/** rrweb's "meta" event: where a new picture of the page starts. */
const META = 4;

/**
 * One person's LRMIS screen as it happens: their browser sends it straight here over a private channel. Until the
 * first picture comes that way (an old tab, a blocked connection) it follows the saved pieces, a few seconds behind.
 */
function LiveScreen({ userId, everyMs }: { userId: string; everyMs: number }) {
  const t = useTranslations("staffActivity");
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"connecting" | "live" | "away">("connecting");

  useEffect(() => {
    const target = box.current;
    if (!target) return;
    let gone = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let replayer: import("rrweb").Replayer | null = null;
    let recording: string | null = null;
    let after = -1;
    // Once the screen comes straight over the channel, the saved pieces only keep the watch going.
    let streamed = false;
    let channel: Awaited<ReturnType<typeof openLiveChannel>> | null = null;
    let watch: ReturnType<typeof setInterval> | undefined;

    const reset = () => {
      replayer?.destroy();
      replayer = null;
      target.replaceChildren();
    };

    // The screen keeps its real size inside, shrunk to fit the space it has.
    const fit = (width: number, height: number) => {
      const wrapper = target.querySelector<HTMLElement>(".replayer-wrapper");
      if (!wrapper || !width) return;
      const scale = target.clientWidth / width;
      wrapper.style.transformOrigin = "top left";
      wrapper.style.transform = `scale(${scale})`;
      target.style.height = `${Math.round(height * scale)}px`;
    };

    const start = async (from?: number) => {
      const { Replayer } = await import("rrweb");
      if (gone) return;
      replayer = new Replayer([], {
        root: target,
        liveMode: true,
        mouseTail: false,
        showWarning: false,
      });
      replayer.on("resize", (d) => {
        const size = d as { width: number; height: number };
        fit(size.width, size.height);
      });
      // Their clock, not ours: each event plays as soon as it arrives.
      replayer.startLive(from);
    };

    // The screen straight from their browser. Batches are handled one after another, in the order they came.
    const assemble = screenAssembler();
    let queue = Promise.resolve();
    const onScreen = (part: ScreenPart) => {
      queue = queue.then(async () => {
        const events = await assemble(part).catch(() => null);
        if (!events?.length || gone) return;
        const meta = events.findIndex((e) => e.type === META);
        if (!streamed || !replayer) {
          if (meta < 0) return;
          reset();
          streamed = true;
          await start(events[meta]!.timestamp);
          if (gone) return;
          for (const e of events.slice(meta)) replayer?.addEvent(e as never);
          setState("live");
          return;
        }
        for (const e of events) replayer?.addEvent(e as never);
      });
    };
    void openLiveChannel(userId).then((ch) => {
      if (gone) return closeLiveChannel(ch);
      channel = ch.on("broadcast", { event: SCREEN_EVENT }, ({ payload }) =>
        onScreen(payload as ScreenPart),
      );
      ch.subscribe((status) => {
        if (status !== "SUBSCRIBED" || gone) return;
        const ask = (fresh: boolean) =>
          void ch.send({ type: "broadcast", event: WATCH_EVENT, payload: { fresh } });
        ask(true);
        clearInterval(watch);
        watch = setInterval(() => ask(!streamed), WATCH_EVERY_MS);
      });
    });

    const look = async () => {
      try {
        const r = await livePiecesAction({
          userId,
          recording,
          after: streamed ? 2_147_483_647 : after,
        });
        if (gone) return;
        if (r.ok && !r.data.recording) {
          reset();
          recording = null;
          after = -1;
          streamed = false;
          setState("away");
        } else if (r.ok) {
          if (r.data.recording !== recording && !streamed) {
            reset();
            recording = r.data.recording;
            after = -1;
          }
          const parts = await Promise.all(r.data.pieces.map((p) => loadPiece(p.url)));
          if (gone) return;
          const events = parts.flat().sort((a, b) => a.timestamp - b.timestamp);
          if (!streamed && !replayer && events.length) await start();
          if (!gone && !streamed) {
            for (const e of events) replayer?.addEvent(e as never);
            recording = r.data.recording;
            after = r.data.pieces.at(-1)?.seq ?? after;
          }
          if (!gone) setState(replayer ? "live" : "connecting");
        }
      } catch {
        // A piece didn't load: the next look asks for it again.
      }
      if (!gone) timer = setTimeout(() => void look(), everyMs);
    };
    void look();

    return () => {
      gone = true;
      clearTimeout(timer);
      clearInterval(watch);
      if (channel) closeLiveChannel(channel);
      reset();
    };
  }, [userId, everyMs]);

  return (
    <div className="bg-muted relative min-h-40 overflow-hidden">
      {/* rr-block: what the admin watches is not recorded again in the admin's own recording. */}
      <div ref={box} className="rr-block pointer-events-none w-full overflow-hidden" />
      {state !== "live" && (
        <p className="text-muted-foreground absolute inset-0 grid place-items-center p-4 text-center text-sm">
          {state === "away" ? t("notOnline") : t("connecting")}
        </p>
      )}
    </div>
  );
}

/** Everyone's LRMIS screen. Press one to see it large. */
export function LiveWall({ locale, initial }: { locale: string; initial: string | null }) {
  const t = useTranslations("staffActivity");
  const [people, setPeople] = useState<LivePerson[] | null>(null);
  const [open, setOpen] = useState<string | null>(initial);

  useEffect(() => {
    const load = async () => {
      const r = await liveListAction({});
      if (r.ok) setPeople(r.data);
    };
    void load();
    const timer = setInterval(() => void load(), LIST_EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  const name = (p: LivePerson) => p.full_name || p.email || "";
  const roles = (p: LivePerson) => (locale === "so" ? p.roles_so : p.roles_en).join(", ");

  if (open) {
    const person = people?.find((p) => p.user_id === open);
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" onClick={() => setOpen(null)}>
            <ArrowLeft aria-hidden />
            {t("closeLive")}
          </Button>
          {person && <span className="font-semibold">{name(person)}</span>}
          {person?.page && (
            <span className="text-muted-foreground font-mono text-xs">{person.page}</span>
          )}
        </div>
        <Card className="overflow-hidden">
          <LiveScreen key={open} userId={open} everyMs={2_000} />
        </Card>
      </div>
    );
  }

  if (people && people.length === 0) {
    return <p className="text-muted-foreground py-12 text-center text-sm">{t("nobodyOnline")}</p>;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {(people ?? []).map((p) => (
        <Card key={p.user_id} className="overflow-hidden">
          <button
            type="button"
            aria-label={t("watchPerson", { name: name(p) })}
            className="block w-full text-start"
            onClick={() => setOpen(p.user_id)}
          >
            <LiveScreen userId={p.user_id} everyMs={4_000} />
            <span className="block border-t p-3">
              <span className="block truncate text-sm font-medium">{name(p)}</span>
              <span className="text-muted-foreground block truncate text-xs">
                {roles(p)}
                {p.page ? ` · ${p.page}` : ""}
              </span>
            </span>
          </button>
        </Card>
      ))}
    </div>
  );
}
