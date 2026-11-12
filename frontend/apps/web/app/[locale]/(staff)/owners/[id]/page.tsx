import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { ClipboardList } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ApplicationStatusBadge } from "@/components/applications/status-badge";
import { PARTY_COLUMNS, type PartyRow } from "@/lib/server/applications";
import { requirePermission } from "@/lib/server/auth";
import { listDistricts } from "@/lib/server/users";
import { createClient } from "@/lib/supabase/server";
import type { ApplicationStatus } from "@dhulka/core/schemas";
import { StatusBadge } from "@dhulka/ui/badge";
import { OwnerRowActions } from "@/components/owners/owner-row-actions";
import { PartyPhoto } from "@/components/owners/party-photo";
import { partyPhotoUrl } from "@/lib/server/party-photo";
import { OwnerHouses } from "@/components/owners/owner-houses";
import { OwnerStatement, type OwnerHouse, type Statement } from "@/components/owners/owner-statement";

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
  const canBills = viewer.can("invoices.view") || viewer.can("billing.view") || viewer.can("payments.view");
  const [{ data }, links, districts, owned, statement] = await Promise.all([
    supabase.from("parties").select(PARTY_COLUMNS).eq("id", id).maybeSingle(),
    supabase
      .from("application_parties")
      .select("role, share_pct, application:applications(id, number, type, status, created_at)")
      .eq("party_id", id),
    listDistricts(),
    // Every house this owner has now.
    supabase
      .from("parcel_owners")
      .select("share_pct, parcel:parcels!inner(id, pun, house_no, status, created_at, deleted_at, neighbourhood:neighbourhoods(name_so, name_en), district:districts(name_so, name_en))")
      .eq("party_id", id)
      .is("valid_to", null)
      .is("parcel.deleted_at", null),
    canBills ? supabase.rpc("owner_statement", { p_party: id }) : Promise.resolve({ data: null }),
  ]);
  const party = data as unknown as PartyRow | null;
  if (!party) notFound();
  const photo = await partyPhotoUrl(party.id);
  const s = statement.data as Statement | null;
  const balances = new Map((s?.houses ?? []).map((h) => [h.id, Number(h.balance)]));
  const houses: OwnerHouse[] = (
    (owned.data ?? []) as unknown as {
      share_pct: number | null;
      parcel: { id: string; pun: string | null; house_no: string | null; status: OwnerHouse["status"]; created_at: string; neighbourhood: { name_so: string; name_en: string } | null; district: { name_so: string; name_en: string } };
    }[]
  )
    .sort((a, b) => a.parcel.created_at.localeCompare(b.parcel.created_at))
    .map(({ share_pct, parcel: p }) => ({
      id: p.id,
      pun: p.pun,
      house_no: p.house_no,
      status: p.status,
      share_pct,
      neighbourhood_so: p.neighbourhood?.name_so ?? null,
      neighbourhood_en: p.neighbourhood?.name_en ?? null,
      district_so: p.district.name_so,
      district_en: p.district.name_en,
      balance: balances.get(p.id),
    }));
  const apps = ((links.data ?? []) as unknown as { role: string; share_pct: number | null; application: { id: string; number: string; type: string; status: ApplicationStatus; created_at: string } | null }[]).filter(
    (l) => l.application,
  );

  const rows: [string, React.ReactNode][] = [
    [t("ownerType"), party.owner_type ? (locale === "so" ? party.owner_type.name_so : party.owner_type.name_en) : null],
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
        description={
          <StatusBadge tone={party.registered_at ? "approved" : "draft"}>
            {party.registered_at
              ? `${t("stateRegistered")} · ${format.dateTime(new Date(party.registered_at), { dateStyle: "medium" })}`
              : t("stateDraft")}
          </StatusBadge>
        }
        actions={
          <OwnerRowActions
            party={party}
            districts={districts}
            onDetail
            can={{
              update: viewer.can("owners.update"),
              remove: viewer.can("owners.delete"),
              removeRegistered: viewer.can("owners.delete_registered"),
            }}
          />
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t("details")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <PartyPhoto
              partyId={party.id}
              url={photo}
              name={party.full_name}
              canEdit={viewer.can("owners.update") || viewer.can("certificates.print")}
            />
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
                      <Mono>{l.application!.number}</Mono>
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
      <div className="mt-6 space-y-6">
        <OwnerHouses houses={houses} />
        {s && <OwnerStatement s={s} />}
      </div>
    </div>
  );
}
