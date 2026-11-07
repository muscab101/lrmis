import { BrandLockup } from "@dhulka/ui/brand";
import { Card, CardContent } from "@dhulka/ui/card";
import { Mono } from "@dhulka/ui/misc";
import { CheckCircle2, CircleAlert, XCircle } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations("verify");
  return { title: t("title"), robots: { index: false } };
}

interface Result {
  type: "certificate" | "id_card";
  status: "valid" | "cancelled" | "expired";
  serial: string;
  pun: string;
  issued_at: string;
  expires_at: string | null;
  /** Certificates: the tax year it covers. */
  tax_year: number | null;
  district: string;
  district_en: string;
  neighbourhood: string | null;
  neighbourhood_en: string | null;
  area_m2: number | null;
  cancelled_at: string | null;
  owners: string[];
}

/** Public check of a certificate or ID card: valid / cancelled / not found, with minimal details. */
export default async function VerifyPage({ params }: { params: Promise<{ locale: string; code: string }> }) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("verify");
  const tc = await getTranslations("common");
  const td = await getTranslations("documents");
  const format = await getFormatter();
  const lang = await getLocale();
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const supabase = await createClient();
  const { data } = clean.length === 12 ? await supabase.rpc("verify_document", { p_code: clean }) : { data: null };
  const r = data as Result | null;
  const tone = !r ? "none" : r.status === "valid" ? "valid" : "bad";
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex h-20 max-w-xl items-center justify-between px-5">
        <Link href="/">
          <BrandLockup name={tc("appShortName")} sub={tc("orgName")} />
        </Link>
        <LocaleSwitch />
      </header>
      <main className="mx-auto max-w-xl px-5 py-10">
        <p className="label-caps text-muted-foreground">{t("title")}</p>
        <div
          className={`mt-3 flex items-center gap-3 rounded-lg p-5 ${tone === "valid" ? "bg-status-approved/10 text-status-approved" : tone === "bad" ? "bg-status-rejected/10 text-status-rejected" : "bg-muted text-foreground"}`}
        >
          {tone === "valid" ? <CheckCircle2 className="size-8" aria-hidden /> : tone === "bad" ? <XCircle className="size-8" aria-hidden /> : <CircleAlert className="size-8" aria-hidden />}
          <div>
            <p className="text-xl font-semibold">{!r ? t("notFound") : t(`result.${r.status}`)}</p>
            <p className="text-sm opacity-80">
              {!r
                ? t("notFoundBody")
                : r.status === "expired" && r.tax_year
                  ? t("expiredBody", { year: r.tax_year })
                  : `${td(`types.${r.type}`)}${r.tax_year ? ` · ${td("taxYear")} ${r.tax_year}` : ""}`}
            </p>
          </div>
        </div>
        {r && (
          <Card className="mt-5">
            <CardContent className="pt-5">
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{td("serial")}</dt>
                <dd>
                  <Mono>{r.serial}</Mono>
                </dd>
                {r.tax_year && (
                  <>
                    <dt className="text-muted-foreground">{td("taxYear")}</dt>
                    <dd className="font-semibold">{r.tax_year}</dd>
                  </>
                )}
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
                <dd>{r.owners.join(", ")}</dd>
                <dt className="text-muted-foreground">{td("issuedOn")}</dt>
                <dd>{format.dateTime(new Date(r.issued_at), { dateStyle: "long" })}</dd>
                {r.expires_at && (
                  <>
                    <dt className="text-muted-foreground">{td("validUntil")}</dt>
                    <dd>{format.dateTime(new Date(r.expires_at), { dateStyle: "long" })}</dd>
                  </>
                )}
                {r.cancelled_at && (
                  <>
                    <dt className="text-muted-foreground">{t("cancelledOn")}</dt>
                    <dd>{format.dateTime(new Date(r.cancelled_at), { dateStyle: "long" })}</dd>
                  </>
                )}
              </dl>
              <p className="mt-4 text-xs text-muted-foreground">{t("privacy")}</p>
            </CardContent>
          </Card>
        )}
        <p className="mt-6 text-sm">
          <Link href="/verify" className="text-primary hover:underline">
            {t("checkAnother")}
          </Link>
        </p>
      </main>
    </div>
  );
}
