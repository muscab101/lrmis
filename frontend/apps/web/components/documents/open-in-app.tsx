import { MonitorSmartphone, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";

/** In place of a certificate in a normal browser: it is shown only in the protected LRMIS desktop app. */
export async function OpenInApp({ serial }: { serial?: string }) {
  const t = await getTranslations("documents.desktop");
  return (
    <div className="bg-card mx-auto flex max-w-xl flex-col items-center rounded-sm border px-8 py-12 text-center">
      <ShieldCheck className="text-primary size-12" aria-hidden />
      <h2 className="mt-4 text-lg font-semibold">{t("title")}</h2>
      <p className="text-muted-foreground mt-2 text-sm">{serial ? t("body", { serial }) : t("bodyAll")}</p>
      <p className="text-muted-foreground mt-6 flex items-center gap-2 text-xs">
        <MonitorSmartphone className="size-4" aria-hidden />
        {t("how")}
      </p>
    </div>
  );
}
