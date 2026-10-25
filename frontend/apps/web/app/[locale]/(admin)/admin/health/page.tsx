import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/server/auth";
import { unwrap } from "@/lib/server/action";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type State = "ok" | "warn" | "fail";
interface Health {
  checked_at: string;
  checks: { key: string; state: State; value: number }[];
  cron: { name: string; schedule: string; active: boolean; last_status: string | null; last_run: string | null }[];
  database: Record<"size_mb" | "parcels" | "parties" | "invoices" | "payments" | "audit_rows" | "active_staff", number>;
}

const TONE: Record<State, string> = { ok: "bg-status-approved", warn: "bg-status-pending", fail: "bg-status-rejected" };

/** Which integrations are configured on this server (presence only, never values). */
function configuration() {
  const has = (k: string) => Boolean(process.env[k]);
  return [
    ["supabase", has("NEXT_PUBLIC_SUPABASE_URL") && has("SUPABASE_SERVICE_ROLE_KEY")],
    ["siteUrl", has("NEXT_PUBLIC_SITE_URL")],
    ["maps", has("NEXT_PUBLIC_MAPTILER_KEY")],
    ["waafipay", has("WAAFIPAY_MERCHANT_UID") || has("WAAFIPAY_API_KEY")],
    ["stripe", has("STRIPE_SECRET_KEY")],
    ["paymentsTestMode", process.env.PAYMENTS_TEST_MODE === "1" || process.env.PAYMENTS_TEST_MODE === "true"],
    ["sms", has("SMS_PROVIDER")],
    ["dispatch", has("MESSAGES_DISPATCH_SECRET")],
    ["ussd", has("USSD_CALLBACK_KEY")],
    ["whatsapp", has("WHATSAPP_TOKEN") && has("WHATSAPP_APP_SECRET")],
    ["assistant", has("DEEPSEEK_API_KEY")],
  ] as const;
}

export default async function HealthPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "settings.view");
  const t = await getTranslations("admin.health");
  const format = await getFormatter();
  const supabase = await createClient();
  const h = unwrap(await supabase.rpc("system_health"), "health") as Health;
  const worst: State = h.checks.some((c) => c.state === "fail") ? "fail" : h.checks.some((c) => c.state === "warn") ? "warn" : "ok";
  const config = configuration();
  const prod = process.env.NODE_ENV === "production";

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle", { time: format.dateTime(new Date(h.checked_at), { timeStyle: "medium" }) })}
        actions={
          <span className="flex items-center gap-2 text-sm font-medium">
            <span className={`size-2.5 rounded-full ${TONE[worst]}`} aria-hidden />
            {t(`overall.${worst}`)}
          </span>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("check")}</TableHead>
                  <TableHead className="text-end">{t("value")}</TableHead>
                  <TableHead>{t("state")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {h.checks.map((c) => (
                  <TableRow key={c.key}>
                    <TableCell className="text-sm">
                      {t(`checks.${c.key}.label`)}
                      {c.state !== "ok" && <span className="block text-xs text-muted-foreground">{t(`checks.${c.key}.fix`)}</span>}
                    </TableCell>
                    <TableCell className="text-end font-mono text-sm tabular-nums">{c.value}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2 text-sm">
                        <span className={`size-2 rounded-full ${TONE[c.state]}`} aria-hidden />
                        {t(`states.${c.state}`)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="text-base">{t("cronTitle")}</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("job")}</TableHead>
                  <TableHead>{t("schedule")}</TableHead>
                  <TableHead>{t("lastRun")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {h.cron.map((j) => (
                  <TableRow key={j.name}>
                    <TableCell>
                      <Mono className="text-xs">{j.name}</Mono>
                    </TableCell>
                    <TableCell>
                      <Mono className="text-xs">{j.schedule}</Mono>
                    </TableCell>
                    <TableCell className="text-sm">
                      {j.last_run ? `${format.dateTime(new Date(j.last_run), { dateStyle: "short", timeStyle: "short" })} · ${j.last_status}` : t("notYet")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("configTitle")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("configHelp")}</p>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {config.map(([k, on]) => (
                  <li key={k} className="flex justify-between gap-2 py-1.5">
                    {t(`config.${k}`)}
                    <span className={k === "paymentsTestMode" ? (on && prod ? "text-status-rejected" : "text-muted-foreground") : on ? "text-status-approved" : "text-muted-foreground"}>
                      {on ? t("on") : t("off")}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("dbTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
                {(Object.keys(h.database) as (keyof Health["database"])[]).map((k) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{t(`db.${k}`)}</dt>
                    <dd className="font-mono tabular-nums">{format.number(Number(h.database[k]))}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
