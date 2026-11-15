"use client";

import { Button } from "@dhulka/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@dhulka/ui/dialog";
import { Input } from "@dhulka/ui/input";
import { Mono } from "@dhulka/ui/misc";
import { CheckCircle2, CircleAlert, ScanLine, X, XCircle } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { verifyCodeAction, type VerifyResult } from "./actions";

/** "ABCDEFGHJKMN" → "ABCD-EFGH-JKMN" while typing. */
const format4 = (v: string) =>
  v
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12)
    .replace(/(.{4})(?=.)/g, "$1-");

/** A scanned QR holds the verify link (…/verify/CODE); a bare code works too. */
const codeFromScan = (raw: string) => {
  const m = raw.match(/verify\/([A-Za-z0-9-]{12,14})/);
  return format4(m ? m[1]! : raw);
};

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

/**
 * Check a certificate or ID card: type the code (or scan the QR with the camera) and the answer opens in a pop-up —
 * valid, expired or cancelled, with the property and owners.
 */
export function VerifyChecker({ initialCode = "" }: { initialCode?: string }) {
  const t = useTranslations("verify");
  const td = useTranslations("documents");
  const format = useFormatter();
  const lang = useLocale();
  const [code, setCode] = useState(format4(initialCode));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<{ code: string; result: VerifyResult | null } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [canScan, setCanScan] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setCanScan(typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  const check = async (value = code) => {
    const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (clean.length !== 12) return setError(t("codeLength"));
    setError(null);
    setBusy(true);
    const res = await verifyCodeAction({ code: clean });
    setBusy(false);
    if (!res.ok) return setError(res.error.code === "RATE_LIMITED" ? t("tooMany") : t("codeLength"));
    setFound(res.data);
    setOpen(true);
  };

  // Camera scan (phones and browsers that read QR codes).
  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let stop = false;
    const Ctor = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    const detector = new Ctor({ formats: ["qr_code"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        while (!stop && video.current) {
          const hits = await detector.detect(video.current).catch(() => []);
          if (hits[0]?.rawValue) {
            const c = codeFromScan(hits[0].rawValue);
            setCode(c);
            setScanning(false);
            void check(c);
            return;
          }
          await new Promise((r) => setTimeout(r, 300));
        }
      } catch {
        setError(t("cameraFailed"));
        setScanning(false);
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((tr) => tr.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per scan
  }, [scanning]);

  const r = found?.result ?? null;
  const tone = !r ? "none" : r.status === "valid" ? "valid" : "bad";
  const date = (d: string) => format.dateTime(new Date(d), { dateStyle: "long" });

  return (
    <>
      <form
        className="mt-6 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void check();
        }}
      >
        <div className="flex flex-wrap gap-2">
          <Input
            value={code}
            onChange={(e) => setCode(format4(e.target.value))}
            placeholder="ABCD-EFGH-JKMN"
            aria-label={t("code")}
            aria-invalid={!!error}
            className="min-w-0 flex-1 font-mono text-lg tracking-wider uppercase"
            autoComplete="off"
            inputMode="text"
            autoFocus
          />
          <Button type="submit" size="lg" loading={busy}>
            {t("check")}
          </Button>
          {canScan && (
            <Button type="button" size="lg" variant="outline" onClick={() => setScanning((s) => !s)}>
              {scanning ? <X aria-hidden /> : <ScanLine aria-hidden />}
              {scanning ? t("stopScan") : t("scan")}
            </Button>
          )}
        </div>
        {error && <p className="text-status-rejected text-sm">{error}</p>}
      </form>
      {scanning && (
        <div className="relative mt-4 overflow-hidden rounded-xl border bg-black">
          <video ref={video} className="aspect-video w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-8 rounded-lg border-2 border-white/70" />
          <p className="absolute inset-x-0 bottom-2 text-center text-xs text-white/90">{t("scanHint")}</p>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="sr-only">{t("title")}</DialogTitle>
            <div
              className={`flex w-full items-center gap-3 rounded-lg p-4 text-start ${tone === "valid" ? "bg-status-approved/10 text-status-approved" : tone === "bad" ? "bg-status-rejected/10 text-status-rejected" : "bg-muted text-foreground"}`}
            >
              {tone === "valid" ? <CheckCircle2 className="size-9 shrink-0" aria-hidden /> : tone === "bad" ? <XCircle className="size-9 shrink-0" aria-hidden /> : <CircleAlert className="size-9 shrink-0" aria-hidden />}
              <div>
                <p className="text-xl font-semibold">{!r ? t("notFound") : t(`result.${r.status}`)}</p>
                <DialogDescription className="text-current opacity-80">
                  {!r
                    ? t("notFoundBody")
                    : r.status === "expired" && r.tax_year
                      ? t("expiredBody", { year: r.tax_year })
                      : r.status === "cancelled"
                        ? t("cancelledBody")
                        : `${td(`types.${r.type}`)}${r.tax_year ? ` · ${td("taxYear")} ${r.tax_year}` : ""}`}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {found && (
            <p className="text-muted-foreground text-xs">
              {t("code")}: <Mono>{format4(found.code)}</Mono>
            </p>
          )}
          {r && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{td("serial")}</dt>
              <dd>
                <Mono>{r.serial}</Mono>
              </dd>
              <dt className="text-muted-foreground">PUN</dt>
              <dd>
                <Mono>{r.pun}</Mono>
              </dd>
              <dt className="text-muted-foreground">{td("district")}</dt>
              <dd>
                {lang === "so" ? r.district : r.district_en}
                {r.neighbourhood && ` · ${lang === "so" ? r.neighbourhood : r.neighbourhood_en}`}
              </dd>
              {r.area_m2 != null && (
                <>
                  <dt className="text-muted-foreground">{td("area")}</dt>
                  <dd>{format.number(Number(r.area_m2), { maximumFractionDigits: 1 })} m²</dd>
                </>
              )}
              <dt className="text-muted-foreground">{td("owners")}</dt>
              <dd>{r.owners.join(", ") || "—"}</dd>
              <dt className="text-muted-foreground">{td("issuedOn")}</dt>
              <dd>{date(r.issued_at)}</dd>
              {r.expires_at && (
                <>
                  <dt className="text-muted-foreground">{td("validUntil")}</dt>
                  <dd className={r.status === "valid" ? "" : "text-status-rejected"}>{date(r.expires_at)}</dd>
                </>
              )}
              {r.cancelled_at && (
                <>
                  <dt className="text-muted-foreground">{t("cancelledOn")}</dt>
                  <dd className="text-status-rejected">{date(r.cancelled_at)}</dd>
                </>
              )}
            </dl>
          )}
          {r && <p className="text-muted-foreground text-xs">{t("privacy")}</p>}
          <DialogFooter className="gap-2">
            <Button
              onClick={() => {
                setOpen(false);
                setCode("");
              }}
            >
              {t("checkAnother")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
