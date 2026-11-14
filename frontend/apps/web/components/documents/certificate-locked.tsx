import { EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";

/** In place of the certificate for people who may print it but not see it (no "See certificate" power). */
export function CertificateLocked({ serial }: { serial: string }) {
  const t = useTranslations("documents");
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 rounded-lg border bg-white px-6 py-10 text-center dark:bg-neutral-950">
      <EyeOff className="text-muted-foreground size-7" aria-hidden />
      <p className="text-sm font-semibold">{t("lockedTitle", { serial })}</p>
      <p className="text-muted-foreground text-sm">{t("lockedBody")}</p>
    </div>
  );
}
