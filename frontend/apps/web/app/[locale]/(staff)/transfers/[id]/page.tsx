import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Alert, Mono, PageHeader } from "@dhulka/ui/misc";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { ParcelInvoices } from "@/components/billing/parcel-invoices";
import { ParcelCertificate } from "@/components/documents/parcel-certificate";
import { OwnershipHistory } from "@/components/legal/ownership-history";
import { TransferActions } from "@/components/legal/transfer-actions";
import { TransferDocuments } from "@/components/legal/transfer-documents";
import { TransferStateBadge, transferState } from "@/components/legal/transfer-state";
import { TransferTimeline } from "@/components/legal/transfer-timeline";
import { GeometryPreview } from "@/components/map/lazy-geometry-preview";
import { Link } from "@/i18n/navigation";
import { fullHouseNo } from "@/lib/house-no";
import { requirePermission } from "@/lib/server/auth";
import { getTransfer } from "@/lib/server/legal";
import { getParcel } from "@/lib/server/parcels";
import { listTransferDocuments } from "@/lib/server/transfer-documents";
import { ownerContacts, parcelPlace, transferEvents } from "@/lib/server/transfer-history";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tr = await getTransfer(id);
  return { title: tr?.number ?? "404" };
}

/** One transfer: its information, the previous and new owners, the land, the files and what happened when. */
export default async function TransferPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "transfers.view");
  const t = await getTranslations("legal");
  const td = await getTranslations("legal.detail");
  const ta = await getTranslations("applications");
  const tst = await getTranslations("legal.states");
  const format = await getFormatter();
  const lang = await getLocale();
  const tr = await getTransfer(id);
  if (!tr) notFound();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const state = transferState(tr.status, tr.review_status);
  const partyIds = [...tr.from_owners, ...tr.to_owners].map((o) => o.party_id);
  const [land, docs, events, contacts, place] = await Promise.all([
    tr.parcel ? getParcel(tr.parcel.id) : null,
    listTransferDocuments(tr.id),
    transferEvents(tr.id),
    ownerContacts(partyIds),
    tr.parcel ? parcelPlace(tr.parcel.id) : null,
  ]);
  const staffIds = [tr.decided_by, tr.reviewed_by].filter((x): x is string => !!x);
  const staff = staffIds.length
    ? (((await (await createClient()).rpc("staff_display_names", { p_user_ids: staffIds })).data ?? []) as { user_id: string; full_name: string }[])
    : [];
  const who = (uid?: string | null) => staff.find((s) => s.user_id === uid)?.full_name ?? null;
  const name = (o: { name_so: string; name_en: string; code?: string } | null | undefined) => (o ? `${lang === "so" ? o.name_so : o.name_en}${o.code ? ` (${o.code})` : ""}` : "—");
  const dutyDue = tr.duty_invoice && Number(tr.duty_invoice.balance) > 0;
  const canCreate = viewer.can("transfers.create");

  const Facts = ({ rows }: { rows: [string, React.ReactNode][] }) => (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">{v}</dd>
        </div>
      ))}
    </dl>
  );

  const Owners = ({ list }: { list: typeof tr.from_owners }) =>
    list.length === 0 ? (
      <p className="text-sm text-muted-foreground">{t("none")}</p>
    ) : (
      <div className="space-y-4">
        {list.map((o) => {
          const c = contacts.find((x) => x.id === o.party_id);
          return (
            <div key={o.party_id} className="space-y-1 text-sm">
              <p className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/owners/${o.party_id}`} className="font-medium hover:text-primary">
                  {o.full_name}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {ta(`roles.${o.role}`)}
                  {o.share_pct != null && Number(o.share_pct) < 100 && ` · ${Number(o.share_pct)}%`}
                </span>
              </p>
              <Facts
                rows={[
                  [td("ownerId"), c?.id_number ? `${c.id_type ? `${c.id_type.replace(/_/g, " ")} · ` : ""}${c.id_number}` : "—"],
                  [td("phone"), c?.phone ? <Mono key="p">{c.phone}</Mono> : "—"],
                  ...(c?.email ? [[td("email"), c.email] as [string, string]] : []),
                  ...(c?.address ? [[td("address"), c.address] as [string, string]] : []),
                ]}
              />
            </div>
          );
        })}
      </div>
    );

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={
          <Link href="/transfers/history" className="hover:underline">
            {td("back")}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Mono>{tr.number}</Mono>
            <TransferStateBadge state={state} label={tst(state)} />
          </span>
        }
      >
        <TransferActions id={tr.id} status={tr.status} review={tr.review_status} can={{ create: canCreate, approve: viewer.can("transfers.approve") }} />
      </PageHeader>
      {state === "needs_documents" && tr.review_note && (
        <Alert tone="warning" title={td("needsDocuments")} className="mb-5">
          {tr.review_note}
        </Alert>
      )}
      {tr.status === "submitted" && dutyDue && (
        <Alert tone="warning" title={t("dutyDueTitle")} className="mb-5">
          {t("dutyDueBody")}
        </Alert>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {/* 1. The transfer. */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{td("s1")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-x-10 gap-y-2 md:grid-cols-2">
              <Facts
                rows={[
                  [td("transferId"), <Mono key="n">{tr.number}</Mono>],
                  [td("date"), format.dateTime(new Date(tr.decided_at ?? tr.submitted_at ?? tr.created_at), { dateStyle: "medium", timeStyle: "short" })],
                  [td("reason"), tr.type ? (lang === "so" ? tr.type.name_so : tr.type.name_en) : t(`transferKinds.${tr.kind}`)],
                  [td("status"), <TransferStateBadge key="s" state={state} label={tst(state)} />],
                  [td("approvedBy"), tr.status === "approved" ? (who(tr.decided_by) ?? "—") : "—"],
                ]}
              />
              <Facts
                rows={[
                  [t("declaredValue"), tr.declared_value != null ? usd(tr.declared_value) : "—"],
                  [
                    t("duty"),
                    tr.duty_invoice ? (
                      <Link key="d" href={`/invoices/${tr.duty_invoice.id}`} className="underline">
                        <Mono>{tr.duty_invoice.number}</Mono> · {usd(tr.duty_invoice.total)} · {dutyDue ? t("dutyUnpaid") : t("dutyPaid")}
                      </Link>
                    ) : (
                      t("dutyOnSubmit")
                    ),
                  ],
                  [t("created"), format.dateTime(new Date(tr.created_at), { dateStyle: "medium", timeStyle: "short" })],
                  ...(tr.note ? [[t("note"), tr.note] as [string, string]] : []),
                  ...(tr.review_note && state !== "needs_documents" ? [[td("reviewNote"), tr.review_note] as [string, string]] : []),
                  ...(tr.decision_note ? [[t("decisionNote"), tr.decision_note] as [string, string]] : []),
                ]}
              />
            </div>
          </CardContent>
        </Card>

        {/* 2 and 3. The owners before and after. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{td("s2")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Owners list={tr.from_owners} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{td("s3")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Owners list={tr.to_owners} />
          </CardContent>
        </Card>

        {/* 4. The land. */}
        {land && (
          <>
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">{td("s4")}</CardTitle>
                <Link href={`/parcels/${land.id}`} className="text-sm text-primary hover:underline">
                  {t("openParcel")}
                </Link>
              </CardHeader>
              <CardContent>
                <Facts
                  rows={[
                    [td("parcelNumber"), <Mono key="p">{land.pun ?? "—"}</Mono>],
                    [td("houseNo"), fullHouseNo(land.neighbourhood?.code, land.house_no) ?? "—"],
                    [td("district"), name(place?.district)],
                    [td("section"), name(place?.section)],
                    [td("sector"), name(place?.sector)],
                    [td("neighbourhood"), name(place?.neighbourhood)],
                    [td("area"), land.area_m2 != null ? `${format.number(Number(land.area_m2), { maximumFractionDigits: 1 })} m²` : "—"],
                  ]}
                />
              </CardContent>
            </Card>
            <GeometryPreview
              geometry={land.geom}
              className="h-72 md:h-full"
              pin
              pinState={land.building_state === "demolished" ? "demolished" : ["draft", "surveyed", "verified"].includes(land.status) ? "partial" : "paid"}
            />
          </>
        )}

        {/* 5. Documents and media. */}
        <div className="md:col-span-2">
          <TransferDocuments
            transferId={tr.id}
            docs={docs}
            canAdd={canCreate && (tr.status === "draft" || tr.status === "submitted")}
            canRemove={canCreate && tr.status === "draft"}
            watermark={`${viewer.profile.full_name || viewer.user.email || ""} · ${format.dateTime(new Date(), { dateStyle: "short", timeStyle: "short" })} · ${tr.number}`}
          />
        </div>

        {/* 6. What happened, when and by whom. */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{td("s6")}</CardTitle>
          </CardHeader>
          <CardContent>
            <TransferTimeline events={events} />
          </CardContent>
        </Card>

        {land && (
          <>
            <div className="md:col-span-2">
              <OwnershipHistory parcelId={land.id} />
            </div>
            {viewer.can("certificates.view") && land.pun && (
              <div className="md:col-span-2">
                <ParcelCertificate parcelId={land.id} pun={land.pun} canIssue={viewer.can("certificates.approve")} />
              </div>
            )}
            {viewer.can("invoices.view") && (
              <div className="md:col-span-2">
                <ParcelInvoices parcelId={land.id} canCreate={viewer.can("invoices.create")} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
