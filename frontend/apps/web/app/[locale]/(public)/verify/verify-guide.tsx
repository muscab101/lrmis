import { CheckCircle2, Clock, QrCode, XCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";

/** Where the code is printed, and what each answer means (under the verify box). */
export async function VerifyGuide() {
  const t = await getTranslations("verify");
  const answers = [
    { key: "valid", icon: CheckCircle2, cls: "text-status-approved" },
    { key: "expired", icon: Clock, cls: "text-status-pending" },
    { key: "cancelled", icon: XCircle, cls: "text-status-rejected" },
  ] as const;
  return (
    <>
      <section className="mt-10 grid gap-4 sm:grid-cols-2">
        <div className="bg-card/60 rounded-xl border p-4">
          <p className="flex items-center gap-2 font-medium">
            <QrCode className="text-primary size-4" aria-hidden />
            {t("whereTitle")}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">{t("whereBody")}</p>
        </div>
        <div className="bg-card/60 rounded-xl border p-4">
          <p className="font-medium">{t("meaningTitle")}</p>
          <ul className="mt-2 space-y-2 text-sm">
            {answers.map(({ key, icon: Icon, cls }) => (
              <li key={key} className="flex gap-2">
                <Icon className={`mt-0.5 size-4 shrink-0 ${cls}`} aria-hidden />
                <span>
                  <span className="font-medium">{t(`result.${key}`)}</span>
                  <span className="text-muted-foreground"> — {t(`meaning.${key}`)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <p className="text-muted-foreground mt-6 text-xs">{t("privacy")}</p>
    </>
  );
}
