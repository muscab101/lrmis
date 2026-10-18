"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Card, CardContent } from "@dhulka/ui/card";
import { AsyncCombobox, type ComboOption } from "@dhulka/ui/combobox";
import { Field } from "@dhulka/ui/field";
import { Input, Textarea } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { searchPartiesAction } from "@/app/[locale]/(staff)/applications/actions";
import { sendSmsAction } from "@/app/[locale]/(staff)/messages/actions";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";

/** Text one person: pick them from the register (fills the number) or type any number. */
export function SingleSms() {
  const t = useTranslations("messages");
  const tc = useTranslations("common");
  const vm = useValidationMessage();
  const router = useRouter();
  const [person, setPerson] = useState<(ComboOption & { phone?: string }) | null>(null);
  const [phone, setPhone] = useState("+252");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const search = useCallback(async (q: string): Promise<ComboOption[]> => {
    const r = await searchPartiesAction({ q });
    return r.ok ? r.data.map((p) => ({ value: p.id, label: p.full_name, hint: p.phone ?? p.id_number ?? "" })) : [];
  }, []);
  const full = `LRMIS: ${text.trim()}`;

  async function send() {
    setBusy(true);
    setError(null);
    const r = await sendSmsAction({ phone, text, partyId: person?.value ?? null });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    toast.success(t("smsQueued"));
    router.push("/messages");
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <FormError error={error && error.code !== "VALIDATION" ? error : null} />
        <Field id="person" label={t("person")} hint={t("personHint")}>
          <div>
            <AsyncCombobox
              search={search}
              value={person ? [person] : []}
              onChange={(o) => {
                const p = o[0] ?? null;
                setPerson(p);
                if (p?.hint && /^\+?\d{8,}/.test(p.hint)) setPhone(p.hint);
              }}
              placeholder={t("searchPerson")}
              searchPlaceholder={tc("search")}
              emptyText={tc("noResults")}
            />
          </div>
        </Field>
        <Field id="phone" label={t("phoneNumber")} error={vm(error?.fieldErrors?.phone?.[0])} required>
          <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field id="text" label={t("messageText")} hint={t("chars", { n: full.length })} error={vm(error?.fieldErrors?.text?.[0])} required>
          <Textarea rows={4} maxLength={600} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        {text.trim() && <p className="rounded-md border bg-muted/40 p-3 text-sm">“{full}”</p>}
        <div className="flex justify-end">
          <Button loading={busy} disabled={text.trim().length < 5} onClick={() => void send()}>
            <Send aria-hidden />
            {t("send")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
