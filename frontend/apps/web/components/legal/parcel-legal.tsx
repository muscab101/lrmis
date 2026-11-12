"use client";

import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { AsyncCombobox, type ComboOption } from "@dhulka/ui/combobox";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { Alert, Mono } from "@dhulka/ui/misc";
import { Scissors } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { searchPartiesAction } from "@/app/[locale]/(staff)/applications/actions";
import {
  addCourtOrderAction,
  applyPermitAction,
  closeDisputeAction,
  createLeaseAction,
  endLeaseAction,
  liftCourtOrderAction,
  openDisputeAction,
  registerLienAction,
  releaseLienAction,
  requestChangeAction,
} from "@/app/[locale]/(staff)/transfers/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link } from "@/i18n/navigation";
import type { ParcelLegal as Data } from "@/lib/server/legal";
import { NoteAction } from "./note-action";
import { TransferWizard } from "./transfer-wizard";

interface Props {
  parcel: { id: string; pun: string; ownership: string; land_use: string; status: string; plot_no: string | null; deed_no: string | null; govt_file_no: string | null; developed: boolean };
  data: Data;
  me: string;
  can: { transfer: boolean; legal: boolean; legalApprove: boolean; change: boolean; permit: boolean; lease: boolean };
  /** Lets the transfer form register a new owner (staff with owners.create). */
  newOwner?: { districts: { id: string; name_so: string; name_en: string }[]; districtId: string | null } | null;
}

type Dialog = null | "dispute" | "order" | "lien" | "use" | "merge" | "permit" | "lease" | "correct";
const USES = ["residential", "commercial", "mixed", "state", "agricultural", "other"] as const;

export function ParcelLegalCard({ parcel, data, me, can, newOwner = null }: Props) {
  const t = useTranslations("legal");
  const ts = useTranslations("stage");
  const tc = useTranslations("common");
  const format = useFormatter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [lessee, setLessee] = useState<ComboOption | null>(null);
  const date = (d: string) => format.dateTime(new Date(d), { dateStyle: "medium" });
  const archived = parcel.status === "archived";
  const blockList = (b: string[]) => (b.length ? b.map((x) => t(`blockers.${x}`)).join(" · ") : t("noBlockers"));
  const searchParties = useCallback(async (q: string): Promise<ComboOption[]> => {
    const res = await searchPartiesAction({ q });
    return res.ok ? res.data.map((p) => ({ value: p.id, label: p.full_name, hint: p.id_number ?? p.phone ?? "" })) : [];
  }, []);
  const open = (d: Dialog) => {
    setF({});
    setDialog(d);
  };
  const openTransfer = data.transfers.find((x) => x.status === "draft" || x.status === "submitted");
  const transferOrders = data.orders.filter((o) => o.active && o.kind === "transfer").map((o) => ({ id: o.id, order_no: o.order_no }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("cardTitle")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("cardHelp")}</p>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        {archived && <Alert tone="warning" title={t("archived")} />}
        <dl className="grid gap-1 sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">{t("canTransfer")}</dt>
          <dd className={data.blockers.transfer.length ? "text-status-rejected" : "text-status-approved"}>{blockList(data.blockers.transfer)}</dd>
          <dt className="text-muted-foreground">{t("canSubdivide")}</dt>
          <dd className={data.blockers.subdivide.length ? "text-status-rejected" : "text-status-approved"}>{blockList(data.blockers.subdivide)}</dd>
        </dl>

        {!archived && (
          <div className="flex flex-wrap gap-2">
            {can.transfer && !openTransfer && <TransferWizard parcelId={parcel.id} types={data.transferTypes} transferOrders={transferOrders} newOwner={newOwner} />}
            {openTransfer && (
              <Button size="sm" variant="outline" asChild>
                <Link href={`/transfers/${openTransfer.id}`}>
                  {t("openTransfer")} <Mono>{openTransfer.number}</Mono>
                </Link>
              </Button>
            )}
            {can.change && (
              <>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/parcels/${parcel.id}/subdivide`}>
                    <Scissors aria-hidden />
                    {t("subdivide")}
                  </Link>
                </Button>
                <Button size="sm" variant="outline" onClick={() => open("merge")}>
                  {t("merge")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => open("use")}>
                  {t("changeUse")}
                </Button>
              </>
            )}
            {can.lease && parcel.ownership === "public" && !data.leases.some((l) => l.status === "active") && (
              <Button size="sm" variant="outline" onClick={() => open("lease")}>
                {t("newLease")}
              </Button>
            )}
          </div>
        )}

        <Section title={t("disputes")} empty={t("none")} items={data.disputes}>
          {(d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <Mono>{d.number}</Mono> · {t(`disputeKinds.${d.kind}`)} · {d.claimant_name}
                <span className="block text-xs text-muted-foreground">{d.status === "open" ? d.description : d.resolution}</span>
              </span>
              <span className="flex items-center gap-2 text-xs">
                {t(`disputeStatus.${d.status}`)}
                {d.status === "open" && can.legalApprove && d.opened_by !== me && (
                  <>
                    <NoteAction label={t("resolve")} title={t("resolveTitle")} noteLabel={t("resolution")} success={t("saved")} submit={(n) => closeDisputeAction({ id: d.id, status: "resolved", note: n })} />
                    <NoteAction label={t("dismiss")} title={t("dismissTitle")} noteLabel={t("resolution")} success={t("saved")} submit={(n) => closeDisputeAction({ id: d.id, status: "dismissed", note: n })} />
                  </>
                )}
              </span>
            </li>
          )}
        </Section>

        <Section title={t("liens")} empty={t("none")} items={data.liens}>
          {(l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {t(`lienKinds.${l.kind}`)} · {l.holder}
                {l.amount != null && ` · ${format.number(Number(l.amount), { style: "currency", currency: "USD" })}`}
                {l.reference && <span className="ms-1 text-xs text-muted-foreground">({l.reference})</span>}
              </span>
              <span className="flex items-center gap-2 text-xs">
                {l.active ? t("active") : t("released")}
                {l.active && can.legalApprove && l.registered_by !== me && (
                  <NoteAction label={t("release")} title={t("releaseTitle")} noteLabel={t("reason")} success={t("saved")} submit={(n) => releaseLienAction({ id: l.id, note: n })} />
                )}
              </span>
            </li>
          )}
        </Section>

        <Section title={t("orders")} empty={t("none")} items={data.orders}>
          {(o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <Mono>{o.order_no}</Mono> · {t(`orderKinds.${o.kind}`)} · {o.court} · {date(o.order_date)}
                <span className="block text-xs text-muted-foreground">{o.description}</span>
              </span>
              <span className="flex items-center gap-2 text-xs">
                {o.active ? t("active") : t("lifted")}
                {o.active && can.legalApprove && o.created_by !== me && (
                  <NoteAction label={t("lift")} title={t("liftTitle")} noteLabel={t("reason")} success={t("saved")} submit={(n) => liftCourtOrderAction({ id: o.id, note: n })} />
                )}
              </span>
            </li>
          )}
        </Section>

        <Section title={t("transfers")} empty={t("none")} items={data.transfers}>
          {(x) => (
            <li key={x.id} className="flex justify-between gap-2 py-2">
              <Link href={`/transfers/${x.id}`} className="hover:text-primary">
                <Mono>{x.number}</Mono> · {t(`transferKinds.${x.kind}`)}
              </Link>
              <span className="text-xs">{t(`status.${x.status}`)}</span>
            </li>
          )}
        </Section>

        <Section title={t("changes")} empty={t("none")} items={data.changes}>
          {(c) => (
            <li key={c.id} className="flex justify-between gap-2 py-2">
              <span>
                <Mono>{c.number}</Mono> · {t(`changeKinds.${c.kind}`)} <span className="text-xs text-muted-foreground">{c.reason}</span>
              </span>
              <span className="text-xs">{t(`status.${c.status}`)}</span>
            </li>
          )}
        </Section>

        <Section title={t("permits")} empty={t("none")} items={data.permits}>
          {(p) => (
            <li key={p.id} className="flex justify-between gap-2 py-2">
              <span>
                <Mono>{p.number}</Mono> · {t(`permitKinds.${p.kind}`)}
              </span>
              <span className="text-xs">
                {t(`status.${p.status}`)}
                {p.valid_until && ` · ${t("until", { date: date(p.valid_until) })}`}
              </span>
            </li>
          )}
        </Section>

        {(parcel.ownership === "public" || data.leases.length > 0) && (
          <Section title={t("leases")} empty={t("none")} items={data.leases}>
            {(l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <Mono>{l.number}</Mono> · {l.lessee?.full_name} · {date(l.start_date)} – {date(l.end_date)} · {format.number(Number(l.annual_rent), { style: "currency", currency: "USD" })}/{t("year")}
                </span>
                <span className="flex items-center gap-2 text-xs">
                  {t(`leaseStatus.${l.status}`)}
                  {l.status === "active" && can.lease && (
                    <NoteAction label={t("endLease")} title={t("endLeaseTitle")} noteLabel={t("reason")} destructive success={t("saved")} submit={(n) => endLeaseAction({ id: l.id, terminate: true, note: n })} />
                  )}
                </span>
              </li>
            )}
          </Section>
        )}
      </CardContent>

      <FormDialog
        open={dialog === "dispute"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("openDispute")}
        description={t("openDisputeBody")}
        confirmLabel={t("openDispute")}
        successMessage={t("saved")}
        submit={() => openDisputeAction({ parcelId: parcel.id, kind: (f.kind ?? "boundary") as "boundary", description: f.description ?? "", claimantName: f.claimant ?? "", claimantPhone: f.phone ?? "", courtCaseNo: f.case ?? "" })}
      >
        {(fe) => (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field id="kind" label={t("kind")}>
                <NativeSelect value={f.kind ?? "boundary"} onChange={(e) => set("kind", e.target.value)}>
                  {(["boundary", "ownership", "inheritance", "other"] as const).map((k) => (
                    <option key={k} value={k}>
                      {t(`disputeKinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="case" label={t("courtCase")}>
                <Input value={f.case ?? ""} onChange={(e) => set("case", e.target.value)} />
              </Field>
              <Field id="claimant" label={t("claimant")} error={fe("claimantName")} required>
                <Input value={f.claimant ?? ""} onChange={(e) => set("claimant", e.target.value)} />
              </Field>
              <Field id="phone" label={t("phone")}>
                <Input inputMode="tel" value={f.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
              </Field>
            </div>
            <Field id="desc" label={t("description")} error={fe("description")} required>
              <Textarea rows={3} value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} />
            </Field>
          </>
        )}
      </FormDialog>

      <FormDialog
        open={dialog === "lien"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("registerLien")}
        description={t("registerLienBody")}
        confirmLabel={t("register")}
        successMessage={t("saved")}
        submit={() => registerLienAction({ parcelId: parcel.id, kind: (f.kind ?? "mortgage") as "mortgage", holder: f.holder ?? "", amount: f.amount ? f.amount : null, reference: f.ref ?? "" })}
      >
        {(fe) => (
          <div className="grid grid-cols-2 gap-3">
            <Field id="kind" label={t("kind")}>
              <NativeSelect value={f.kind ?? "mortgage"} onChange={(e) => set("kind", e.target.value)}>
                {(["mortgage", "lien", "caveat"] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`lienKinds.${k}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="holder" label={t("holder")} error={fe("holder")} required>
              <Input value={f.holder ?? ""} onChange={(e) => set("holder", e.target.value)} />
            </Field>
            <Field id="amount" label={t("amount")}>
              <Input type="number" min={0} value={f.amount ?? ""} onChange={(e) => set("amount", e.target.value)} />
            </Field>
            <Field id="ref" label={t("reference")}>
              <Input value={f.ref ?? ""} onChange={(e) => set("ref", e.target.value)} />
            </Field>
          </div>
        )}
      </FormDialog>

      <FormDialog
        open={dialog === "order"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("addOrder")}
        description={t("addOrderBody")}
        confirmLabel={t("record")}
        successMessage={t("saved")}
        submit={() => addCourtOrderAction({ parcelId: parcel.id, orderNo: f.no ?? "", court: f.court ?? "", orderDate: f.date ?? "", kind: (f.kind ?? "freeze") as "freeze", description: f.description ?? "" })}
      >
        {(fe) => (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field id="no" label={t("orderNo")} error={fe("orderNo")} required>
                <Input value={f.no ?? ""} onChange={(e) => set("no", e.target.value)} />
              </Field>
              <Field id="date" label={t("orderDate")} error={fe("orderDate")} required>
                <Input type="date" value={f.date ?? ""} onChange={(e) => set("date", e.target.value)} />
              </Field>
              <Field id="court" label={t("court")} error={fe("court")} required>
                <Input value={f.court ?? ""} onChange={(e) => set("court", e.target.value)} />
              </Field>
              <Field id="kind" label={t("kind")}>
                <NativeSelect value={f.kind ?? "freeze"} onChange={(e) => set("kind", e.target.value)}>
                  {(["freeze", "transfer", "release", "other"] as const).map((k) => (
                    <option key={k} value={k}>
                      {t(`orderKinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Field id="desc" label={t("description")} error={fe("description")} required>
              <Textarea rows={3} value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} />
            </Field>
          </>
        )}
      </FormDialog>

      <FormDialog
        open={dialog === "use"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("changeUse")}
        description={t("changeUseBody", { current: ts(`landUses.${parcel.land_use}`) })}
        confirmLabel={t("submitRequest")}
        successMessage={t("requested")}
        submit={() => requestChangeAction({ kind: "change_of_use", parcelIds: [parcel.id], landUse: (f.use ?? USES.find((u) => u !== parcel.land_use)) as "commercial", reason: f.reason ?? "" })}
      >
        {(fe) => (
          <>
            <Field id="use" label={t("newUse")} error={fe("landUse")}>
              <NativeSelect value={f.use ?? USES.find((u) => u !== parcel.land_use)} onChange={(e) => set("use", e.target.value)}>
                {USES.filter((u) => u !== parcel.land_use).map((u) => (
                  <option key={u} value={u}>
                    {ts(`landUses.${u}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="reason" label={t("reason")} error={fe("reason")} required>
              <Textarea rows={3} value={f.reason ?? ""} onChange={(e) => set("reason", e.target.value)} />
            </Field>
          </>
        )}
      </FormDialog>

      <FormDialog
        open={dialog === "merge"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("merge")}
        description={t("mergeBody")}
        confirmLabel={t("submitRequest")}
        successMessage={t("requested")}
        submit={() => requestChangeAction({ kind: "merge", parcelIds: [parcel.id], otherPuns: (f.puns ?? "").split(/[\s,]+/).filter(Boolean), reason: f.reason ?? "" })}
      >
        {(fe) => (
          <>
            <Field id="puns" label={t("otherPuns")} hint={t("otherPunsHint")} error={fe("otherPuns")} required>
              <Input className="font-mono" value={f.puns ?? ""} onChange={(e) => set("puns", e.target.value)} />
            </Field>
            <Field id="reason" label={t("reason")} error={fe("reason")} required>
              <Textarea rows={3} value={f.reason ?? ""} onChange={(e) => set("reason", e.target.value)} />
            </Field>
          </>
        )}
      </FormDialog>

      <FormDialog
        open={dialog === "permit"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("applyPermit")}
        description={t("applyPermitBody")}
        confirmLabel={t("submitRequest")}
        successMessage={t("permitApplied")}
        submit={() =>
          applyPermitAction({
            parcelId: parcel.id,
            kind: (f.kind ?? "construction") as "construction",
            description: f.description ?? "",
            floors: f.floors ? f.floors : null,
            areaM2: f.area ? f.area : null,
            applicantName: f.applicant ?? "",
            applicantPhone: f.phone ?? "",
          })
        }
      >
        {(fe) => (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field id="kind" label={t("kind")}>
                <NativeSelect value={f.kind ?? "construction"} onChange={(e) => set("kind", e.target.value)}>
                  {(["construction", "extension", "renovation", "demolition", "fence"] as const).map((k) => (
                    <option key={k} value={k}>
                      {t(`permitKinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="applicant" label={t("applicant")} error={fe("applicantName")} required>
                <Input value={f.applicant ?? ""} onChange={(e) => set("applicant", e.target.value)} />
              </Field>
              <Field id="floors" label={t("floors")}>
                <Input type="number" min={0} value={f.floors ?? ""} onChange={(e) => set("floors", e.target.value)} />
              </Field>
              <Field id="area" label={t("areaM2")}>
                <Input type="number" min={0} value={f.area ?? ""} onChange={(e) => set("area", e.target.value)} />
              </Field>
            </div>
            <Field id="desc" label={t("works")} error={fe("description")} required>
              <Textarea rows={3} value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} />
            </Field>
          </>
        )}
      </FormDialog>

      <FormDialog
        open={dialog === "lease"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("newLease")}
        description={t("newLeaseBody")}
        confirmLabel={t("record")}
        successMessage={t("saved")}
        submit={() => createLeaseAction({ parcelId: parcel.id, lesseeId: lessee?.value ?? "", start: f.start ?? "", end: f.end ?? "", rent: f.rent ?? "", purpose: f.purpose ?? "" })}
      >
        {(fe) => (
          <>
            <Field id="lessee" label={t("lessee")} error={fe("lesseeId")} required>
              <div>
                <AsyncCombobox search={searchParties} value={lessee ? [lessee] : []} onChange={(o) => setLessee(o[0] ?? null)} placeholder={t("addPerson")} searchPlaceholder={tc("search")} emptyText={tc("noResults")} />
              </div>
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field id="start" label={t("start")} error={fe("start")} required>
                <Input type="date" value={f.start ?? ""} onChange={(e) => set("start", e.target.value)} />
              </Field>
              <Field id="end" label={t("end")} error={fe("end")} required>
                <Input type="date" value={f.end ?? ""} onChange={(e) => set("end", e.target.value)} />
              </Field>
              <Field id="rent" label={t("annualRent")} error={fe("rent")} required>
                <Input type="number" min={0} value={f.rent ?? ""} onChange={(e) => set("rent", e.target.value)} />
              </Field>
            </div>
            <Field id="purpose" label={t("purpose")}>
              <Input value={f.purpose ?? ""} onChange={(e) => set("purpose", e.target.value)} />
            </Field>
          </>
        )}
      </FormDialog>
      <FormDialog
        open={dialog === "correct"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("dataCorrection")}
        description={t("dataCorrectionBody")}
        confirmLabel={t("submitRequest")}
        successMessage={t("requested")}
        submit={() => {
          // Only what actually changed goes into the request.
          const c: { plot_no?: string; deed_no?: string; govt_file_no?: string; ownership?: "public" | "private"; developed?: boolean } = {};
          if ((f.plot ?? "") !== (parcel.plot_no ?? "")) c.plot_no = f.plot ?? "";
          if ((f.deed ?? "") !== (parcel.deed_no ?? "")) c.deed_no = f.deed ?? "";
          if ((f.file ?? "") !== (parcel.govt_file_no ?? "")) c.govt_file_no = f.file ?? "";
          if (f.own && f.own !== parcel.ownership) c.ownership = f.own as "public" | "private";
          if ((f.dev === "yes") !== parcel.developed) c.developed = f.dev === "yes";
          return requestChangeAction({ kind: "correction", parcelIds: [parcel.id], correction: c, reason: f.reason ?? "" });
        }}
      >
        {(fe) => (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field id="plot" label={t("plotNo")}>
                <Input value={f.plot ?? ""} onChange={(e) => set("plot", e.target.value)} />
              </Field>
              <Field id="deed" label={t("deedNo")}>
                <Input value={f.deed ?? ""} onChange={(e) => set("deed", e.target.value)} />
              </Field>
              <Field id="file" label={t("fileNo")}>
                <Input value={f.file ?? ""} onChange={(e) => set("file", e.target.value)} />
              </Field>
              <Field id="own" label={t("ownership")}>
                <NativeSelect value={f.own ?? "private"} onChange={(e) => set("own", e.target.value)}>
                  <option value="private">{t("ownershipPrivate")}</option>
                  <option value="public">{t("ownershipPublic")}</option>
                </NativeSelect>
              </Field>
              <Field id="dev" label={t("developed")}>
                <NativeSelect value={f.dev ?? "no"} onChange={(e) => set("dev", e.target.value)}>
                  <option value="yes">{t("yes")}</option>
                  <option value="no">{t("no")}</option>
                </NativeSelect>
              </Field>
            </div>
            {fe("correction") && <p className="text-sm text-status-rejected">{fe("correction")}</p>}
            <Field id="reason" label={t("reason")} error={fe("reason")} required>
              <Textarea rows={3} value={f.reason ?? ""} onChange={(e) => set("reason", e.target.value)} />
            </Field>
            <p className="text-xs text-muted-foreground">
              {t("boundaryCorrectionHint")}{" "}
              <Link href={`/parcels/${parcel.id}/correct`} className="text-primary hover:underline">
                {t("correctBoundary")}
              </Link>
            </p>
          </>
        )}
      </FormDialog>
    </Card>
  );
}

function Section<T>({ title, empty, items, children }: { title: string; empty: string; items: T[]; children: (item: T) => React.ReactNode }) {
  return (
    <section>
      <h3 className="label-caps mb-1 text-muted-foreground">{title}</h3>
      {items.length === 0 ? <p className="text-muted-foreground">{empty}</p> : <ul className="divide-y">{items.map(children)}</ul>}
    </section>
  );
}
