"use client";

import { Button } from "@dhulka/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@dhulka/ui/dialog";
import { Camera, RefreshCw, RotateCcw, SwitchCamera } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Take a picture with the computer's or phone's camera and hand it back as a JPEG file (it is then sent like any
 * attached picture). The camera is on only while this window is open.
 */
export function CameraCapture({ onPicture }: { onPicture: (file: File) => void }) {
  const t = useTranslations("chat.camera");
  const [open, setOpen] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState<"denied" | "none" | null>(null);
  const [cameras, setCameras] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((tr) => tr.stop());
    stream.current = null;
  }, []);

  // Start the camera when the window opens (and when switching front/back); stop it when it closes.
  useEffect(() => {
    if (!open || shot) return;
    let cancelled = false;
    setError(null);
    void (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) return s.getTracks().forEach((tr) => tr.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => {});
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        setCameras(devices.filter((d) => d.kind === "videoinput").length);
      } catch (e) {
        setError((e as DOMException).name === "NotAllowedError" ? "denied" : "none");
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, facing, shot, stop, attempt]);

  const close = () => {
    stop();
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
    setOpen(false);
  };

  const take = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // The front camera shows a mirror image on screen; the picture itself is the right way round.
    ctx.drawImage(v, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      stop();
      setShot({ blob, url: URL.createObjectURL(blob) });
    }, "image/jpeg", 0.88);
  };

  const use = () => {
    if (!shot) return;
    const name = `photo-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`;
    onPicture(new File([shot.blob], name, { type: "image/jpeg" }));
    close();
  };

  return (
    <>
      <Button
        size="icon-sm"
        variant="outline"
        className="size-10"
        aria-label={t("open")}
        onClick={() => setOpen(true)}
        disabled={typeof navigator !== "undefined" && !navigator.mediaDevices?.getUserMedia}
      >
        <Camera aria-hidden />
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
          <DialogTitle className="px-5 pt-5 pb-3 text-base">{t("title")}</DialogTitle>
          <div className="relative aspect-video w-full bg-black">
            {shot ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local picture just taken, not a page image
              <img src={shot.url} alt={t("preview")} className="size-full object-contain" />
            ) : (
              <video
                ref={video}
                playsInline
                muted
                className={`size-full object-contain ${facing === "user" ? "-scale-x-100" : ""}`}
              />
            )}
            {error && (
              <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/80">
                {t(error === "denied" ? "denied" : "noCamera")}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 p-4">
            <div>
              {!shot && cameras > 1 && (
                <Button variant="outline" size="sm" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}>
                  <SwitchCamera aria-hidden />
                  {t("switch")}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {shot ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      URL.revokeObjectURL(shot.url);
                      setShot(null);
                    }}
                  >
                    <RotateCcw aria-hidden />
                    {t("again")}
                  </Button>
                  <Button onClick={use}>{t("use")}</Button>
                </>
              ) : error ? (
                <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
                  <RefreshCw aria-hidden />
                  {t("retry")}
                </Button>
              ) : (
                <Button onClick={take}>
                  <Camera aria-hidden />
                  {t("take")}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
