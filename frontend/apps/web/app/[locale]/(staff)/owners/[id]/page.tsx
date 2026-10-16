import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { BadgeCheck, ClipboardList } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ApplicationStatusBadge } from "@/components/applications/status-badge";
import { Link } from "@/i18n/navigation";
import { PARTY_COLUMNS, type PartyRow } from "@/lib/server/applications";
import { requirePermission } from "@/lib/server/auth";
import { listDistricts } from "@/lib/server/users";
import { createClient } from "@/lib/supabase/server";
import type { ApplicationStatus } from "@dhulka/core/schemas";
import { EditOwner } from "./edit-owner";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { title: "404" };
  const supabase = await createClient();
  const { data } = await supabase.from("parties").select("full_name").eq("id", id).maybeSingle();
  return { title: (data as { full_name?: string } | null)?.full_name ?? "404" };
}

export default async function OwnerPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "owners.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = await getTranslations("owners");
  const ta = await getTranslations("applications");
  const format = await getFormatter();
  const supabase = await createClient();
  const [{ data }, links, districts] = await Promise.all([
    supabase.from("parties").select(PARTY_COLUMNS).eq("id", id).maybeSingle(),
    supabase
      .from("application_parties")
      .select("role, share_pct, application:applications(id, number, type, status, created_at)")
      .eq("party_id", id),
    listDistricts(),
  ]);
  const party = data as unknown as PartyRow | null;
  if (!party) notFound();
  const apps = ((links.data ?? []) as unknown as { role: string; share_pct: number | null; application: { id: string; number: string; type: string; status: ApplicationStatus; created_at: string } | null }[]).filter(
    (l) => l.application,
  );

  const rows: [string, React.ReactNode][] = [
    [t("motherName"), party.mother_name],
    [t("gender"), party.gender ? t(party.gender) : null],
    [t("dateOfBirth"), party.date_of_birth ? format.dateTime(new Date(party.date_of_birth), { dateStyle: "long" }) : null],
    [t("nationality"), party.nationality],
    [t("idNumber"), party.id_number ? <Mono key="id">{`${party.id_type ? t(`id_${party.id_type}`) + " · " : ""}${party.id_number}`}</Mono> : null],
    [
      t("phone"),
      party.phone ? (
        <span key="ph" className="inline-flex items-center gap-1 font-mono">
          {party.phone}
          {party.phone_verified_at && <BadgeCheck className="size-4 text-success" aria-label={t("verified")} />}
        </span>
      ) : null,
    ],
    [t("email"), party.email],
    [t("address"), party.address],
    [t("orgRegistrationNo"), party.org_registration_no],
    [t("nextOfKinName"), party.next_of_kin?.name ? `${party.next_of_kin.name}${party.next_of_kin.phone ? ` · ${party.next_of_kin.phone}` : ""}` : null],
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={t(`kind_${party.kind}`)}
        title={party.full_name}
        actions={viewer.can("owners.update") && <EditOwner party={party} districts={districts} />}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t("details")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
              {rows
                .filter(([, v]) => v !== null && v !== undefined && v !== "")
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>{t("applications")}</CardTitle>
          </CardHeader>
          {apps.length === 0 ? (
            <EmptyState icon={<ClipboardList />} title={t("noApplications")} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{ta("number")}</TableHead>
                  <TableHead>{ta("role")}</TableHead>
                  <TableHead>{ta("statusLabel")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apps.map((l) => (
                  <TableRow key={l.application!.id}>
                    <TableCell>
                      <Link href={`/applications/${l.application!.id}`} className="hover:text-primary">
                        <Mono>{l.application!.number}</Mono>
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      {ta(`roles.${l.role}`)}
                      {l.share_pct ? ` · ${l.share_pct}%` : ""}
                    </TableCell>
                    <TableCell>
                      <ApplicationStatusBadge status={l.application!.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
