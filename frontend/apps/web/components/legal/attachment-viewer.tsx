"use client";

import { Button } from "@dhulka/ui/button";
import { ChevronLeft, ChevronRight, EyeOff, FileText, Loader2, Music2, Pause, Play, ShieldAlert, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { fileKind } from "@/lib/transfer-files";

export interface Attachment {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
  url: string | null;
  category: string;
  description: string | null;
  uploader: string | null;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
const clock = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "–:––");
const stop = (e: React.SyntheticEvent) => e.preventDefault();

// ---- PDF (pdf.js, loaded only when a PDF is shown) ----
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
};
let pdfLib: Promise<typeof import("pdfjs-dist")> | null = null;
const docs = new Map<string, Promise<PdfDoc>>();
function openPdf(url: string): Promise<PdfDoc> {
  pdfLib ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return m;
  });
  let d = docs.get(url);
  if (!d) {
    d = pdfLib.then((m) => m.getDocument({ url, isEvalSupported: false }).promise as unknown as Promise<PdfDoc>);
    docs.set(url, d);
  }
  return d;
}

/** One page of a PDF drawn on a canvas, `width` pixels wide (a picture, not a file: nothing to save or select). */
function PdfCanvas({ url, page, width, onPages }: { url: string; page: number; width: number; onPages?: (n: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  useEffect(() => {
    let live = true;
    setState("loading");
    openPdf(url)
      .then(async (doc) => {
        onPages?.(doc.numPages);
        const p = await doc.getPage(Math.min(Math.max(page, 1), doc.numPages));
        const base = p.getViewport({ scale: 1 });
        const ratio = window.devicePixelRatio || 1;
        const viewport = p.getViewport({ scale: (width / base.width) * ratio });
        const canvas = ref.current;
        if (!live || !canvas) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / ratio}px`;
        await p.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
        if (live) setState("ok");
      })
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
    // onPages is a setter from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, page, width]);
  return (
    <div className="relative flex items-center justify-center">
      {state === "loading" && <Loader2 className="absolute size-5 animate-spin text-muted-foreground" aria-hidden />}
      {state === "error" && <FileText className="size-10 text-muted-foreground" aria-hidden />}
      <canvas ref={ref} onContextMenu={stop} className={state === "ok" ? "rounded-sm bg-white shadow" : "invisible h-0"} />
    </div>
  );
}

/**
 * Keeps what is shown from being saved or copied, as far as a browser allows: no right-click, dragging or selecting,
 * nothing printed, the viewer's name and the time written across it, and a blur whenever the window loses focus (which
 * is what most screenshot tools do) or Print Screen is pressed. A screenshot can't be stopped by any website, but it
 * shows who took it and when.
 */
function Protected({ watermark, children, className = "" }: { watermark: string; children: React.ReactNode; className?: string }) {
  const t = useTranslations("legal.files");
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const hide = () => setHidden(true);
    const vis = () => setHidden(document.visibilityState !== "visible");
    const key = (e: KeyboardEvent) => {
      // Print Screen, and the screenshot shortcuts of Windows (Win+Shift+S) and macOS (Cmd+Shift+3/4/5).
      if (e.key === "PrintScreen" || (e.shiftKey && (e.metaKey || e.key === "Meta") && ["3", "4", "5", "s", "S"].includes(e.key))) {
        setHidden(true);
        void navigator.clipboard?.writeText?.("").catch(() => undefined);
      }
    };
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    return () => {
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
    };
  }, []);
  return (
    <div
      onContextMenu={stop}
      onDragStart={stop}
      onCopy={stop}
      className={`relative select-none print:hidden ${className}`}
      style={{ WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
    >
      <div className={hidden ? "pointer-events-none blur-2xl" : ""}>{children}</div>
      {/* Who is looking, and when, across the whole preview. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{
          backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(
            `<svg xmlns='http://www.w3.org/2000/svg' width='340' height='160'><text x='10' y='90' fill='rgba(120,120,120,0.22)' font-family='sans-serif' font-size='15' transform='rotate(-22 170 80)'>${watermark.replace(/[<>&]/g, "")}</text></svg>`,
          )}")`,
        }}
      />
      {hidden && (
        <button
          type="button"
          onClick={() => setHidden(false)}
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-card/70 text-sm font-medium"
        >
          <EyeOff className="size-6" aria-hidden />
          {t("hiddenTap")}
        </button>
      )}
    </div>
  );
}

// ---- Small previews in the list ----
function Thumb({ a, onPages }: { a: Attachment; onPages?: (n: number) => void }) {
  const kind = fileKind(a.file_name, a.mime_type);
  const [duration, setDuration] = useState<number | null>(null);
  if (!a.url) return <FileText className="size-6 text-muted-foreground" aria-hidden />;
  if (kind === "pdf") return <PdfCanvas url={a.url} page={1} width={72} onPages={onPages} />;
  // eslint-disable-next-line @next/next/no-img-element
  if (kind === "image") return <img src={a.url} alt="" draggable={false} onContextMenu={stop} className="size-full object-cover" loading="lazy" />;
  if (kind === "video")
    return (
      <>
        <video src={`${a.url}#t=0.5`} preload="metadata" muted onContextMenu={stop} className="size-full object-cover" onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-7 items-center justify-center rounded-full bg-black/60 text-white">
            <Play className="size-3.5 translate-x-px" aria-hidden />
          </span>
        </span>
        {duration != null && <span className="absolute end-1 bottom-1 rounded bg-black/70 px-1 font-mono text-[9px] text-white">{clock(duration)}</span>}
      </>
    );
  if (kind === "audio")
    return (
      <span className="flex flex-col items-center text-primary">
        <Music2 className="size-6" aria-hidden />
        <audio src={a.url} preload="metadata" className="hidden" onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} />
        {duration != null && <span className="font-mono text-[10px] text-muted-foreground">{clock(duration)}</span>}
      </span>
    );
  return <FileText className="size-7 text-blue-700 dark:text-blue-300" aria-hidden />;
}

const KIND_TAG: Record<ReturnType<typeof fileKind>, string> = { pdf: "PDF", image: "IMG", video: "VIDEO", audio: "AUDIO", other: "DOC" };

/**
 * A transfer's files, shown right on the page: a large preview of the chosen file (PDF page by page, pictures with zoom,
 * video and audio players) and the list of every file beside it, File 2 of 5, previous / next. Files can be looked at
 * but not downloaded; the preview is protected (see Protected).
 */
export function AttachmentGallery({
  items,
  categoryLabel,
  onRemove,
  canRemove = false,
  watermark,
  freshUrl,
}: {
  items: Attachment[];
  categoryLabel: (c: string) => string;
  onRemove?: (id: string) => void;
  canRemove?: boolean;
  /** Written across the preview: who is looking and when. */
  watermark: string;
  /** A new short-lived link for a file (links run out after 15 minutes, while a video plays in pieces). */
  freshUrl?: (id: string) => Promise<string | null>;
}) {
  const t = useTranslations("legal.files");
  const format = useFormatter();
  const [index, setIndex] = useState(0);
  const [pages, setPages] = useState<Record<string, number>>({});
  const i = Math.min(index, items.length - 1);
  const item = items[i]!;
  // The file shown gets a fresh link when it is chosen, and again if the player fails (an old link may have run out).
  const [links, setLinks] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, number>>({});
  // Held in a ref: the page passes a new function on every render, which must not fetch again each time.
  const fresh = useRef(freshUrl);
  useEffect(() => {
    fresh.current = freshUrl;
  }, [freshUrl]);
  const refresh = useCallback(async (id: string) => {
    const u = fresh.current ? await fresh.current(id) : null;
    if (u) setLinks((l) => ({ ...l, [id]: u }));
    return !!u;
  }, []);
  useEffect(() => {
    void refresh(item.id);
  }, [item.id, refresh]);
  const a = { ...item, url: links[item.id] ?? item.url };
  const kind = fileKind(a.file_name, a.mime_type);
  const mediaError = async (code: number | undefined) => {
    const tries = failed[a.id] ?? 0;
    setFailed((f) => ({ ...f, [a.id]: tries + 1 }));
    // A link that ran out: try once more with a new one.
    if (tries === 0 && code !== 4) await refresh(a.id);
  };
  const mediaCode = useRef<number | undefined>(undefined);
  const prev = useCallback(() => setIndex((x) => (x - 1 + items.length) % items.length), [items.length]);
  const next = useCallback(() => setIndex((x) => (x + 1) % items.length), [items.length]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
      {/* The chosen file, large. */}
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button size="sm" variant="outline" onClick={prev} disabled={items.length < 2}>
            <ChevronLeft aria-hidden />
            {t("previous")}
          </Button>
          <span className="tabular-nums">{t("fileOf", { n: i + 1, total: items.length })}</span>
          <Button size="sm" variant="outline" onClick={next} disabled={items.length < 2}>
            {t("next")}
            <ChevronRight aria-hidden />
          </Button>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="min-w-0 truncate font-medium">{a.file_name}</p>
          <p className="text-xs text-muted-foreground">
            {categoryLabel(a.category)} · {formatBytes(a.size_bytes)} · {format.dateTime(new Date(a.uploaded_at), { dateStyle: "medium", timeStyle: "short" })}
            {a.uploader && ` · ${a.uploader}`}
          </p>
        </div>
        {a.description && <p className="text-sm">{a.description}</p>}
        <Protected watermark={watermark} className="h-[72vh] min-h-[26rem] overflow-auto rounded-lg border bg-muted/60 p-3">
          {!a.url ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t("unavailable")}</p>
          ) : kind === "pdf" ? (
            <PdfViewer key={a.id} url={a.url} />
          ) : kind === "image" ? (
            <ImageViewer key={a.id} url={a.url} name={a.file_name} />
          ) : kind === "video" ? (
            <div className="flex h-full items-center justify-center">
              {(failed[a.id] ?? 0) > 1 || ((failed[a.id] ?? 0) > 0 && mediaCode.current === 4) ? (
                <p className="max-w-sm text-center text-sm text-muted-foreground">{mediaCode.current === 4 ? t("cantPlay") : t("cantLoad")}</p>
              ) : (
              <video
                key={`${a.id}${a.url}`}
                src={a.url}
                playsInline
                preload="metadata"
                onError={(e) => {
                  mediaCode.current = e.currentTarget.error?.code;
                  void mediaError(e.currentTarget.error?.code);
                }}
                controls
                controlsList="nodownload nofullscreen noremoteplayback noplaybackrate"
                disablePictureInPicture
                onContextMenu={stop}
                // Fills the viewer: as wide as it is, and nearly as tall; the picture keeps its shape inside.
                className="h-[66vh] min-h-80 w-full rounded-md bg-black object-contain"
              />
              )}
            </div>
          ) : kind === "audio" ? (
            <AudioPlayer key={`${a.id}${a.url}`} url={a.url} name={a.file_name} onError={() => void mediaError(undefined)} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <FileText className="size-14 text-blue-700 dark:text-blue-300" aria-hidden />
              <p className="max-w-sm text-sm text-muted-foreground">{t("noPreview")}</p>
            </div>
          )}
        </Protected>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldAlert className="size-3.5" aria-hidden />
          {t("protectedNote")}
        </p>
      </div>

      {/* Every file: choose one to show it. */}
      <ul className="space-y-2 lg:max-h-[calc(72vh+6rem)] lg:overflow-y-auto">
        {items.map((x, n) => {
          const k = fileKind(x.file_name, x.mime_type);
          return (
            <li key={x.id}>
              <div
                className={`flex gap-2.5 rounded-lg border p-2 transition-colors ${n === i ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/40"}`}
              >
                <button
                  type="button"
                  onClick={() => setIndex(n)}
                  className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/60"
                  aria-label={t("view", { name: x.file_name })}
                >
                  <Thumb a={x} onPages={(p) => setPages((m) => (m[x.id] === p ? m : { ...m, [x.id]: p }))} />
                  <span className="absolute start-0.5 top-0.5 rounded bg-card-solid/90 px-1 text-[9px] font-semibold">{KIND_TAG[k]}</span>
                </button>
                <button type="button" onClick={() => setIndex(n)} className="min-w-0 flex-1 text-start">
                  <span className="block truncate text-sm font-medium" title={x.file_name}>
                    {x.file_name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{categoryLabel(x.category)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatBytes(x.size_bytes)}
                    {k === "pdf" && pages[x.id] ? ` · ${t("pages", { n: pages[x.id]! })}` : ""}
                  </span>
                </button>
                {canRemove && onRemove && (
                  <Button size="icon-sm" variant="ghost" className="self-start text-danger" aria-label={t("remove")} title={t("remove")} onClick={() => onRemove(x.id)}>
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PdfViewer({ url }: { url: string }) {
  const t = useTranslations("legal.files");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const w = wrap.current?.clientWidth ?? 800;
    setWidth(Math.min(Math.max(w - 24, 300), 1000));
  }, []);
  return (
    <div ref={wrap} className="space-y-2">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-center gap-2 rounded-md bg-card-solid/95 p-1 text-sm shadow-sm">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          <ChevronLeft aria-hidden />
          {t("previousPage")}
        </Button>
        <span className="tabular-nums">{t("pageOf", { n: page, total: pages || "…" })}</span>
        <Button size="sm" variant="ghost" disabled={pages > 0 && page >= pages} onClick={() => setPage((p) => p + 1)}>
          {t("nextPage")}
          <ChevronRight aria-hidden />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={t("zoomOut")} onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
          <ZoomOut aria-hidden />
        </Button>
        <span className="w-10 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
        <Button size="icon-sm" variant="ghost" aria-label={t("zoomIn")} onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
          <ZoomIn aria-hidden />
        </Button>
      </div>
      <PdfCanvas url={url} page={page} width={Math.round(width * zoom)} onPages={setPages} />
    </div>
  );
}

function ImageViewer({ url, name }: { url: string; name: string }) {
  const t = useTranslations("legal.files");
  const [zoom, setZoom] = useState(1);
  return (
    <div className="space-y-2">
      <div className="sticky top-0 z-10 flex items-center justify-center gap-1 rounded-md bg-card-solid/95 p-1 shadow-sm">
        <Button size="icon-sm" variant="ghost" aria-label={t("zoomOut")} onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>
          <ZoomOut aria-hidden />
        </Button>
        <span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
        <Button size="icon-sm" variant="ghost" aria-label={t("zoomIn")} onClick={() => setZoom((z) => Math.min(4, z + 0.25))}>
          <ZoomIn aria-hidden />
        </Button>
      </div>
      <div className="flex justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          draggable={false}
          onContextMenu={stop}
          style={{ width: zoom === 1 ? undefined : `${zoom * 100}%`, maxWidth: zoom <= 1 ? "100%" : "none" }}
          className="h-auto max-h-[64vh] rounded-md object-contain"
        />
      </div>
    </div>
  );
}

function AudioPlayer({ url, name, onError }: { url: string; name: string; onError?: () => void }) {
  const t = useTranslations("legal.files");
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(Number.NaN);
  const ext = name.split(".").pop()?.toUpperCase() ?? "";
  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-full max-w-lg space-y-4 rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Music2 className="size-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{name}</p>
            <p className="text-xs text-muted-foreground">{t("audioFile", { ext })}</p>
          </div>
        </div>
        <audio
          ref={ref}
          src={url}
          preload="metadata"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={onError}
        />
        <div className="flex items-center gap-3">
          <Button size="icon" className="rounded-full" aria-label={playing ? t("pause") : t("play")} onClick={() => (playing ? ref.current?.pause() : void ref.current?.play())}>
            {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
          </Button>
          <input
            type="range"
            min={0}
            max={Number.isFinite(duration) ? duration : 0}
            step={0.1}
            value={time}
            aria-label={t("progress")}
            onChange={(e) => {
              if (ref.current) ref.current.currentTime = Number(e.target.value);
            }}
            className="flex-1 accent-primary"
          />
          <span className="w-24 text-end font-mono text-xs tabular-nums">
            {clock(time)} / {clock(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}
