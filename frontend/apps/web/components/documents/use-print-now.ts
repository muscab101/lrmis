"use client";

import { toast } from "@dhulka/ui/toaster";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { printNowAction } from "@/app/[locale]/(staff)/documents/actions";
import { useRouter } from "@/i18n/navigation";
import { useErrorMessage } from "@/lib/client/errors";

/**
 * Print certificates or ID cards without opening a page: each goes straight to the added printer at this person's
 * point of sale (or its district's printer). Says how it went in a message.
 */
export function usePrintNow() {
  const t = useTranslations("documents");
  const locale = useLocale();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const print = async (ids: string[]) => {
    setBusy(true);
    let sent = 0;
    let printer = "";
    let online = true;
    const problems: string[] = [];
    for (const id of ids) {
      const res = await printNowAction({ id, locale: locale === "en" ? "en" : "so" });
      if (res.ok) {
        sent += 1;
        printer = res.data.printer;
        online = online && res.data.online;
      } else problems.push(errorMessage(res.error));
    }
    setBusy(false);
    if (sent === 1 && ids.length === 1) toast.success(online ? t("printNowSent", { printer }) : t("printNowQueued", { printer }));
    else if (sent > 0) toast.success(t("printNowMany", { count: sent, printer }));
    if (problems.length) toast.error(ids.length === 1 ? problems[0]! : t("printNowSomeFailed", { count: problems.length, reason: problems[0]! }));
    if (sent > 0) router.refresh();
    return sent;
  };
  return { print, busy };
}
