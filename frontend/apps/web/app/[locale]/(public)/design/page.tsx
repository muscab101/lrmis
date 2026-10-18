import { Badge, StatusBadge } from "@dhulka/ui/badge";
import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Field } from "@dhulka/ui/field";
import { Input, Textarea } from "@dhulka/ui/input";
import { Alert, EmptyState, Kbd, KpiChip, Mono, PageHeader, Skeleton } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Inbox, Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { DesignFolders } from "./folders";
import { DesignInteractive } from "./interactive";

const COLOURS = [
  ["primary", "bg-primary"],
  ["accent", "bg-accent"],
  ["success", "bg-success"],
  ["warning", "bg-warning"],
  ["danger", "bg-danger"],
  ["info", "bg-info"],
  ["surface", "bg-surface"],
  ["muted", "bg-muted"],
  ["border", "bg-border"],
  ["foreground", "bg-foreground"],
] as const;

/** Living style guide: every token and component in light and dark. */
export default async function DesignPage({ params }: { params: Promise<{ locale: string }> }) {
  // Component gallery for developers only.
  if (process.env.NODE_ENV === "production" && process.env.DESIGN_GALLERY !== "1") notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("design");

  return (
    <main className="mx-auto max-w-6xl space-y-10 px-4 py-10">
      <PageHeader title={t("title")} description={t("subtitle")} actions={<><LocaleSwitch /><ThemeToggle /></>} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("colours")}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {COLOURS.map(([name, cls]) => (
            <div key={name} className="overflow-hidden rounded-md border bg-card">
              <div className={`h-14 ${cls}`} />
              <div className="p-2 text-xs">
                <Mono>--{name}</Mono>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="draft">{t("statusDraft")}</StatusBadge>
          <StatusBadge tone="pending">{t("statusPending")}</StatusBadge>
          <StatusBadge tone="approved">{t("statusApproved")}</StatusBadge>
          <StatusBadge tone="rejected">{t("statusRejected")}</StatusBadge>
          <StatusBadge tone="partial">{t("statusPartial")}</StatusBadge>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("typography")}</h2>
        <Card className="space-y-2 p-5">
          <p className="text-3xl font-semibold tracking-tight">LRMIS — Gobolka Banaadir</p>
          <p className="text-base">Inter · {t("bodyText")}</p>
          <p className="text-sm text-muted-foreground">{t("mutedText")}</p>
          <p>
            PUN <Mono>BN-HDN-012-000123</Mono> · {t("receipt")} <Mono>RC-2026-004512</Mono> · <Kbd>⌘K</Kbd>
          </p>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("buttons")}</h2>
        <div className="flex flex-wrap gap-2">
          <Button>
            <Plus aria-hidden />
            Primary
          </Button>
          <Button variant="accent">Accent</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
          <Button loading>{t("saving")}</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>Default</Badge>
          <Badge variant="accent">Accent</Badge>
          <Badge variant="muted">Muted</Badge>
          <Badge variant="outline">Outline</Badge>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("forms")}</CardTitle>
            <CardDescription>{t("formsBody")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field id="d-name" label={t("fieldName")} required>
              <Input placeholder="Cabdi Xasan" />
            </Field>
            <Field id="d-phone" label={t("fieldPhone")} error={t("fieldError")}>
              <Input defaultValue="0611" />
            </Field>
            <Field id="d-notes" label={t("fieldNotes")} hint={t("fieldHint")}>
              <Textarea />
            </Field>
            <DesignInteractive />
          </CardContent>
        </Card>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <KpiChip label={t("kpiRevenue")} value="$1,240,500" tone="success" />
            <KpiChip label={t("kpiOverdue")} value="312" tone="danger" />
            <KpiChip label={t("kpiPending")} value="48" tone="warning" />
          </div>
          <Alert tone="info" title={t("alertInfo")}>{t("alertBody")}</Alert>
          <Alert tone="danger" title={t("alertDanger")}>{t("alertBody")}</Alert>
          <Card>
            <EmptyState icon={<Inbox />} title={t("emptyTitle")} description={t("emptyBody")} action={<Button size="sm">{t("emptyAction")}</Button>} />
          </Card>
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("table")}</h2>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PUN</TableHead>
                <TableHead>{t("owner")}</TableHead>
                <TableHead className="text-end">{t("balance")}</TableHead>
                <TableHead>{t("status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ["BN-HDN-012-000123", "Cabdi Xasan", "$0.00", "approved"],
                ["BN-WDJ-004-000045", "Faadumo Cali", "$120.00", "partial"],
                ["BN-HDN-031-000981", "Maxamed Nuur", "$340.00", "rejected"],
              ].map(([pun, owner, bal, tone]) => (
                <TableRow key={pun}>
                  <TableCell>
                    <Mono>{pun}</Mono>
                  </TableCell>
                  <TableCell>{owner}</TableCell>
                  <TableCell className="text-end">{bal}</TableCell>
                  <TableCell>
                    <StatusBadge tone={tone as "approved"}>{t(`tone_${tone}`)}</StatusBadge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("folders")}</h2>
        <DesignFolders />
      </section>
    </main>
  );
}
