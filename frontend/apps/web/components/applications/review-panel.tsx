"use client";

import { Button } from "@dhulka/ui/button";
import { Alert, Mono } from "@dhulka/ui/misc";
import { toast } from "@dhulka/ui/toaster";
import { CheckCircle2, CircleAlert, Send } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { submitApplicationAction } from "@/app/[locale]/(staff)/applications/actions";
import { Link, useRouter } from "@/i18n/navigation";
import { useErrorMessage } from "@/lib/client/errors";

interface Props {
  applicationId: string;
  checklist: { code: string; value?: string | number }[];
  nearby: { id: string; number: string; distance_m: number }[];
  docTypes: { code: string; name_so: string; name_en: string }[];
  showNearbyLinks: boolean;
}

/** Final step: what is still missing, possible duplicates nearby, submit. */
export function ReviewPanel({ applicationId, checklist, nearby, docTypes, showNearbyLinks }: Props) {
  const t = useTranslations("applications");
  const locale = useLocale();
  const router = useRouter();
  const errorText = useErrorMessage();
  const [submitting, setSubmitting] = useState(false);
  const docName = (code: string) => {
    const d = docTypes.find((x) => x.code === code);
    return d ? (locale === "so" ? d.name_so : d.name_en) : code;
  };

  async function submit() {
    setSubmitting(true);
    const res = await submitApplicationAction({ applicationId });
    setSubmitting(false);
    if (!res.ok) return toast.error(errorText(res.error));
    toast.success(t("submitted", { number: res.data.number }));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {checklist.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="size-4" aria-hidden />
          {t("readyToSubmit")}
        </p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {checklist.map((p, i) => (
            <li key={i} className="flex items-start gap-2 text-warning">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="text-foreground">
                {p.code === "missing_document" ? t("check.missing_document", { name: docName(String(p.value)) }) : t(`check.${p.code}`, { value: String(p.value ?? "") })}
              </span>
            </li>
          ))}
        </ul>
      )}
      {nearby.length > 0 && (
        <Alert tone="warning" title={t("nearbyTitle", { count: nearby.length })}>
          <ul className="mt-1 space-y-0.5">
            {nearby.map((n) => (
              <li key={n.id}>
                {showNearbyLinks ? (
                  <Link href={`/applications/${n.id}`} className="underline">
                    <Mono>{n.number}</Mono>
                  </Link>
                ) : (
                  <Mono>{n.number}</Mono>
                )}{" "}
                — {t("metresAway", { m: n.distance_m.toFixed(1) })}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      <Button type="button" size="lg" className="w-full sm:w-auto" disabled={checklist.length > 0} loading={submitting} onClick={() => void submit()}>
        <Send aria-hidden />
        {t("submit")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("afterSubmitNote")}</p>
    </div>
  );
}
