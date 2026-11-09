"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Textarea } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { Send, TriangleAlert } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { systemWarningSendAction } from "@/app/[locale]/(staff)/messages/actions";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";
import type { SystemWarning } from "@/lib/server/messages";

/** Write a warning and send it to every open screen; the last ones sent are listed below. */
export function WarningComposer({
  recent,
  districts,
}: {
  recent: SystemWarning[];
  districts: { id: string; name: string }[];
}) {
  const t = useTranslations("messages.warning");
  const tw = useTranslations("systemWarning");
  const format = useFormatter();
  const locale = useLocale();
  const vm = useValidationMessage();
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  // "" is every district; otherwise the one district it goes to.
  const [district, setDistrict] = useState("");
  const districtName = districts.find((d) => d.id === district)?.name;
  const ready = text.trim().length >= 3;

  return (
    <div className="grid gap-6 p-5 lg:grid-cols-[1fr_20rem]">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const res = await systemWarningSendAction({
            message: text,
            district: district || null,
          });
          setBusy(false);
          if (!res.ok) return setError(res.error);
          toast.success(t("sent"));
          setText("");
          router.refresh();
        }}
      >
        <div>
          <h2 className="font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t("body")}</p>
        </div>
        <FormError error={error && !error.fieldErrors ? error : null} />
        <Field id="warningTo" label={t("to")} required>
          <NativeSelect
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            className="max-w-sm"
          >
            <option value="">{t("all")}</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          id="warningText"
          label={t("label")}
          hint={`${text.trim().length} / 300`}
          error={vm(error?.fieldErrors?.message?.[0])}
          required
        >
          <Textarea
            rows={3}
            maxLength={300}
            value={text}
            placeholder={t("placeholder")}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        {text.trim().length > 0 && (
          <div>
            <p className="text-muted-foreground mb-1.5 text-xs">{t("preview")}</p>
            <div className="dark:bg-card/90 flex max-w-xl items-start gap-4 rounded-sm border border-white/70 bg-white/90 p-6 font-sans shadow-sm backdrop-blur-xl dark:border-white/10">
              <TriangleAlert className="text-danger mt-1 size-9 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="text-danger text-xs font-bold">
                  {tw("title")} · {districtName ?? tw("everyone")}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-2xl font-semibold leading-snug">{text.trim()}</p>
              </div>
            </div>
          </div>
        )}
        <Button type="submit" disabled={busy || !ready}>
          <Send aria-hidden />
          {t("send")} · {districtName ?? t("toAll")}
        </Button>
      </form>
      <div>
        <h3 className="mb-2 text-sm font-medium">{t("recent")}</h3>
        {recent.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("none")}</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {recent.map((w) => (
              <li key={w.id} className="px-3 py-2">
                <p className="whitespace-pre-wrap">{w.message}</p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {format.dateTime(new Date(w.created_at), { dateStyle: "medium", timeStyle: "short" })}
                  {w.sender ? ` · ${t("by", { name: w.sender })}` : ""}
                  {" · "}
                  {w.district ? (locale === "so" ? w.district.name_so : w.district.name_en) : t("all")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
