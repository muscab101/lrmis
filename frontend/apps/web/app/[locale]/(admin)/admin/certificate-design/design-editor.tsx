"use client";

import { Button } from "@dhulka/ui/button";
import { Card, CardContent } from "@dhulka/ui/card";
import { Field } from "@dhulka/ui/field";
import { Switch } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useErrorMessage } from "@/lib/client/errors";
import type { CertificateDesign } from "@/lib/server/certificate-design";
import { saveCertificateDesignAction } from "./actions";

const COLOURS = ["#1f45b8", "#0b1a3a", "#15803d", "#0e7490", "#7c2d12", "#6d28d9", "#b91c1c"];

/** The design form with a small live preview of the certificate's top. */
export function DesignEditor({ design, defaults }: { design: CertificateDesign; defaults: { titleSo: string; titleEn: string } }) {
  const t = useTranslations("certificateDesign");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [d, setD] = useState({
    accent: design.accent,
    titleSo: design.title_so ?? "",
    titleEn: design.title_en ?? "",
    note: design.note ?? "",
    watermark: design.watermark,
    seals: design.seals,
  });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof d>) => setD((x) => ({ ...x, ...patch }));
  const save = async () => {
    setBusy(true);
    const res = await saveCertificateDesignAction(d);
    setBusy(false);
    if (!res.ok) return toast.error(errorMessage(res.error));
    toast.success(t("saved"));
    router.refresh();
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardContent className="space-y-5 pt-5">
          <Field id="accent" label={t("colour")} hint={t("colourHint")}>
            <div className="flex flex-wrap items-center gap-2">
              {COLOURS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => set({ accent: c })}
                  className={`size-8 rounded-full border-2 ${d.accent.toLowerCase() === c ? "border-foreground" : "border-transparent"}`}
                  style={{ background: c }}
                />
              ))}
              <Input type="color" className="h-8 w-14 p-1" value={d.accent} onChange={(e) => set({ accent: e.target.value })} aria-label={t("colour")} />
            </div>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="title-so" label={t("titleSo")} hint={t("emptyStandard")}>
              <Input value={d.titleSo} maxLength={120} placeholder={defaults.titleSo} onChange={(e) => set({ titleSo: e.target.value })} />
            </Field>
            <Field id="title-en" label={t("titleEn")} hint={t("emptyStandard")}>
              <Input value={d.titleEn} maxLength={120} placeholder={defaults.titleEn} onChange={(e) => set({ titleEn: e.target.value })} />
            </Field>
          </div>
          <Field id="note" label={t("note")} hint={t("noteHint")}>
            <Textarea rows={2} maxLength={300} value={d.note} onChange={(e) => set({ note: e.target.value })} />
          </Field>
          <label className="flex items-start gap-3 text-sm">
            <Switch checked={d.watermark} onCheckedChange={(v) => set({ watermark: v })} />
            <span>
              <span className="font-medium">{t("watermark")}</span>
              <span className="text-muted-foreground block text-xs">{t("watermarkHint")}</span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <Switch checked={d.seals} onCheckedChange={(v) => set({ seals: v })} />
            <span>
              <span className="font-medium">{t("seals")}</span>
              <span className="text-muted-foreground block text-xs">{t("sealsHint")}</span>
            </span>
          </label>
          <div className="flex justify-end">
            <Button loading={busy} onClick={save}>
              {t("save")}
            </Button>
          </div>
        </CardContent>
      </Card>
      {/* A small preview of the top of a certificate. */}
      <div className="h-fit rounded-lg border bg-white p-5 text-center text-[#0b1a3a] shadow-sm" style={{ borderColor: d.accent }}>
        <p className="text-[11px] text-neutral-500">{t("preview")}</p>
        <p className="mt-2 text-lg font-semibold leading-tight">{d.titleSo || defaults.titleSo}</p>
        <p className="text-sm font-medium" style={{ color: d.accent }}>
          {d.titleEn || defaults.titleEn}
        </p>
        <div className="mt-3 rounded-md border px-3 py-2 text-start text-xs" style={{ borderColor: `${d.accent}55`, background: `${d.accent}0a` }}>
          <span className="font-semibold" style={{ color: d.accent }}>
            {t("taxYearSample")}
          </span>
        </div>
        {d.note && <p className="mt-3 text-[11px] text-neutral-600">{d.note}</p>}
      </div>
    </div>
  );
}
