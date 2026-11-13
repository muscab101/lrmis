import "server-only";
import { getTranslations } from "next-intl/server";
import { fullHouseNo } from "@/lib/house-no";
import type {
  ArrearsRow,
  BillingRow,
  CashierRow,
  CertificateRow,
  CertificateStatusRow,
  CollectionRow,
  DemolishedRow,
  MessageRow,
  StaffActivityRow,
  SurveyZoneRow,
  TransferRow,
  IncomeRow,
  InvoiceRow,
  LocationRow,
  OwnerRow,
  ParcelRow,
  PaymentRow,
  PaymentTypeRow,
  CollectionsRow,
  CollectionsCashierRow,
  ShortageRow,
  UnreconciledRow,
  RegistrationRow,
  ReportName,
  RevenueDetailRow,
  RevenueRow,
} from "./reports";

export type CellKind = "text" | "mono" | "money" | "int" | "num" | "pct" | "date" | "datetime";
export type Cell = string | number | null;

export interface Column {
  label: string;
  kind: CellKind;
  /** Add this column up in the totals row. */
  sum?: boolean;
}

/** One report as plain columns and rows: the page, the PDF and the Excel file all draw from this. */
export interface ReportTable {
  title: string;
  columns: Column[];
  rows: Cell[][];
  /** Totals row (null where a column has no total), or null when the report has none. */
  totals: Cell[] | null;
  /** Per row and column, the page a cell opens (the invoice, the parcel, ...), or null. Only the page uses these. */
  links: (string | null)[][];
}

const CHANNEL_COLUMNS = [
  "cash",
  "evc_plus",
  "edahab",
  "zaad",
  "bank_transfer",
  "card",
  "other",
] as const;

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

/**
 * `drill` builds a link to another report with the page's filters plus some of its own; the page passes it so
 * summary rows open the matching list (the export files don't need it).
 */
export async function reportTable(
  name: ReportName,
  data: unknown[],
  locale: string,
  drill?: (report: ReportName, over: Record<string, string>) => string,
): Promise<ReportTable> {
  const t = await getTranslations({ locale, namespace: "reports" });
  const all = await getTranslations({ locale });
  const so = locale === "so";
  const pick = (r: Record<string, unknown>, base: string) =>
    ((so ? r[`${base}_so`] : r[`${base}_en`]) as string | null) ?? null;
  /** A value label from an existing catalog section, or the raw value when there is none. */
  const label = (ns: string, v: string | null) =>
    v === null ? null : all.has(`${ns}.${v}`) ? all(`${ns}.${v}`) : v;
  /** Just the day of a date-time (the page and files show it as a date). */
  const day = (v: string | null) => (v ? v.slice(0, 10) : null);
  const yesNo = (v: boolean | null) => (v === null ? null : v ? t("yes") : t("no"));
  // Cash, EVC Plus, eDahab, ZAAD, Bank transfer, Visa / Mastercard, Other: the columns of every collections report.
  const channelColumns: Column[] = CHANNEL_COLUMNS.map((c) => ({
    label: all(`collections.channels.${c}`),
    kind: "money",
    sum: true,
  }));

  let columns: Column[];
  let rows: Cell[][];
  let links: (string | null)[][] = [];
  const to = (base: string, id: string | null | undefined) => (id ? `/${base}/${id}` : null);
  switch (name) {
    case "revenue": {
      // One line per payment (the detail view) or one per month and fee.
      if (data.length && "receipt_no" in (data[0] as object)) {
        columns = [
          { label: t("received"), kind: "datetime" },
          { label: t("receipt"), kind: "mono" },
          { label: t("pun"), kind: "mono" },
          { label: t("payer"), kind: "text" },
          { label: t("feeType"), kind: "text" },
          { label: t("invoice"), kind: "mono" },
          { label: t("billStatusLabel"), kind: "text" },
          { label: t("checkStatusLabel"), kind: "text" },
          { label: t("method"), kind: "text" },
          { label: t("amount"), kind: "money", sum: true },
        ];
        rows = (data as RevenueDetailRow[]).map((r) => [
          r.received_at,
          r.receipt_no,
          r.pun,
          r.payer,
          so ? r.fee_name_so : r.fee_name_en,
          r.invoice_number,
          r.bill_status ? t(`billStatus.${r.bill_status}`) : null,
          t(`checkStatus.${r.check_status}`),
          label("collections.channels", r.channel),
          num(r.amount),
        ]);
        break;
      }
      columns = [
        { label: t("month"), kind: "mono" },
        { label: t("feeType"), kind: "text" },
        { label: t("payments"), kind: "int", sum: true },
        { label: t("amount"), kind: "money", sum: true },
      ];
      rows = (data as RevenueRow[]).map((r) => [
        r.month,
        so ? r.fee_name_so : r.fee_name_en,
        num(r.payments),
        num(r.amount),
      ]);
      break;
    }
    case "billing": {
      columns = [
        { label: t("month"), kind: "mono" },
        { label: t("district"), kind: "text" },
        { label: t("feeType"), kind: "text" },
        { label: t("invoices"), kind: "int", sum: true },
        { label: t("billed"), kind: "money", sum: true },
        { label: t("collected"), kind: "money", sum: true },
        { label: t("credited"), kind: "money", sum: true },
        { label: t("outstanding"), kind: "money", sum: true },
      ];
      rows = (data as BillingRow[]).map((r) => [
        r.month,
        pick(r as never, "district"),
        pick(r as never, "fee_name"),
        num(r.invoices),
        num(r.billed),
        num(r.collected),
        num(r.credited),
        num(r.outstanding),
      ]);
      break;
    }
    case "income": {
      columns = [
        { label: t("month"), kind: "mono" },
        { label: t("incomeLabel"), kind: "money", sum: true },
        { label: t("expensesLabel"), kind: "money", sum: true },
        { label: t("cashIn"), kind: "money", sum: true },
        { label: t("cashOut"), kind: "money", sum: true },
        { label: t("netCash"), kind: "money", sum: true },
      ];
      rows = (data as IncomeRow[]).map((r) => [
        r.month,
        num(r.income),
        num(r.expenses),
        num(r.cash_in),
        num(r.cash_out),
        num(r.net),
      ]);
      break;
    }
    case "arrears": {
      const buckets = ["not_due", "d1_30", "d31_90", "d91_180", "d180", "total"] as const;
      columns = [
        { label: t("district"), kind: "text" },
        { label: t("invoices"), kind: "int", sum: true },
        ...buckets.map((b) => ({ label: t(`buckets.${b}`), kind: "money" as const, sum: true })),
      ];
      rows = (data as ArrearsRow[]).map((r) => [
        pick(r as never, "district"),
        num(r.invoices),
        ...buckets.map((b) => num(r[b])),
      ]);
      break;
    }
    case "collection": {
      columns = [
        { label: t("district"), kind: "text" },
        { label: t("invoices"), kind: "int", sum: true },
        { label: t("billed"), kind: "money", sum: true },
        { label: t("collected"), kind: "money", sum: true },
        { label: t("credited"), kind: "money", sum: true },
        { label: t("outstanding"), kind: "money", sum: true },
        { label: t("rate"), kind: "pct" },
      ];
      rows = (data as CollectionRow[]).map((r) => [
        pick(r as never, "district"),
        num(r.invoices),
        num(r.billed),
        num(r.collected),
        num(r.credited),
        num(r.outstanding),
        num(r.rate),
      ]);
      break;
    }
    case "registrations": {
      columns = [
        { label: t("month"), kind: "mono" },
        { label: t("submitted"), kind: "int", sum: true },
        { label: t("registered"), kind: "int", sum: true },
        { label: t("rejected"), kind: "int", sum: true },
        { label: t("medianDays"), kind: "num" },
      ];
      rows = (data as RegistrationRow[]).map((r) => [
        r.month,
        num(r.submitted),
        num(r.registered),
        num(r.rejected),
        num(r.median_days),
      ]);
      break;
    }
    case "cashiers": {
      columns = [
        { label: t("cashier"), kind: "text" },
        { label: t("shifts"), kind: "int", sum: true },
        { label: t("payments"), kind: "int", sum: true },
        { label: t("amount"), kind: "money", sum: true },
        { label: t("difference"), kind: "money", sum: true },
      ];
      rows = (data as CashierRow[]).map((r) => [
        r.cashier_name,
        num(r.shifts),
        num(r.payments),
        num(r.amount),
        num(r.difference),
      ]);
      break;
    }
    case "invoices": {
      columns = [
        { label: t("number"), kind: "mono" },
        { label: t("pun"), kind: "mono" },
        { label: t("district"), kind: "text" },
        { label: t("feeType"), kind: "text" },
        { label: t("issueDate"), kind: "date" },
        { label: t("dueDate"), kind: "date" },
        { label: t("total"), kind: "money", sum: true },
        { label: t("paid"), kind: "money", sum: true },
        { label: t("balance"), kind: "money", sum: true },
        { label: t("status"), kind: "text" },
      ];
      rows = (data as InvoiceRow[]).map((r) => [
        r.number,
        r.pun,
        pick(r as never, "district"),
        pick(r as never, "fee_name"),
        r.issue_date,
        r.due_date,
        num(r.total),
        num(r.paid),
        num(r.balance),
        label("billing.invoiceStatus", r.status),
      ]);
      links = (data as InvoiceRow[]).map((r) => [
        to("invoices", r.invoice_id),
        to("parcels", r.parcel_id),
      ]);
      break;
    }
    case "payments": {
      columns = [
        { label: t("receipt"), kind: "mono" },
        { label: t("date"), kind: "datetime" },
        { label: t("pun"), kind: "mono" },
        { label: t("invoice"), kind: "mono" },
        { label: t("feeType"), kind: "text" },
        { label: t("method"), kind: "text" },
        { label: t("cashier"), kind: "text" },
        { label: t("pos"), kind: "text" },
        { label: t("amount"), kind: "money", sum: true },
        { label: t("status"), kind: "text" },
      ];
      rows = (data as PaymentRow[]).map((r) => [
        r.receipt_no,
        r.received_at,
        r.pun,
        r.invoices,
        pick(r as never, "fee_types"),
        label("payments.methods", r.method),
        r.cashier,
        r.point_of_sale,
        num(r.amount),
        label("payments.status", r.status),
      ]);
      links = (data as PaymentRow[]).map((r) => [
        to("payments", r.payment_id),
        null,
        to("parcels", r.parcel_id),
      ]);
      break;
    }
    case "paymentTypes": {
      const methods = CHANNEL_COLUMNS;
      columns = [
        { label: t("feeType"), kind: "text" },
        { label: t("payments"), kind: "int", sum: true },
        ...channelColumns,
        { label: t("grandTotal"), kind: "money", sum: true },
      ];
      rows = (data as PaymentTypeRow[]).map((r) => [
        pick(r as never, "fee_name"),
        num(r.payments),
        ...methods.map((m) => num(r[m])),
        num(r.total),
      ]);
      // A fee type opens its payments; an amount opens the payments of that fee type made that way.
      links = drill
        ? (data as PaymentTypeRow[]).map((r) => [
            drill("payments", { fee: r.fee_type }),
            null,
            ...methods.map((m) =>
              Number(r[m]) ? drill("payments", { fee: r.fee_type, method: m }) : null,
            ),
            drill("payments", { fee: r.fee_type }),
          ])
        : [];
      break;
    }
    case "collections": {
      const fmt = (d: string, opts: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat(so ? "so" : "en-GB", { timeZone: "UTC", ...opts }).format(
          new Date(`${String(d).slice(0, 10)}T00:00:00Z`),
        );
      // Days by date, weeks by their Monday–Sunday range, months by name.
      const periodLabel = (r: CollectionsRow) => {
        const a = String(r.period).slice(0, 10);
        const b = String(r.period_end).slice(0, 10);
        if (a === b) return fmt(a, { day: "2-digit", month: "short", year: "numeric" });
        if (a.slice(8) === "01" && b.slice(0, 7) === a.slice(0, 7))
          return fmt(a, { month: "long", year: "numeric" });
        return `${fmt(a, { day: "2-digit", month: "short" })} – ${fmt(b, { day: "2-digit", month: "short", year: "numeric" })}`;
      };
      columns = [
        { label: t("period_"), kind: "text" },
        { label: t("payments"), kind: "int", sum: true },
        ...channelColumns,
        { label: t("grandTotal"), kind: "money", sum: true },
      ];
      rows = (data as CollectionsRow[]).map((r) => [
        periodLabel(r),
        num(r.payments),
        ...CHANNEL_COLUMNS.map((c) => num(r[c])),
        num(r.total),
      ]);
      break;
    }
    case "collectionsCashier": {
      columns = [
        { label: t("cashier"), kind: "text" },
        { label: t("payments"), kind: "int", sum: true },
        ...channelColumns,
        { label: t("grandTotal"), kind: "money", sum: true },
        { label: t("unchecked"), kind: "money", sum: true },
        { label: t("reconciledDays"), kind: "text" },
        { label: t("shortage"), kind: "money", sum: true },
        { label: t("excess"), kind: "money", sum: true },
      ];
      rows = (data as CollectionsCashierRow[]).map((r) => [
        r.cashier_id ? r.cashier : t("online"),
        num(r.payments),
        ...CHANNEL_COLUMNS.map((c) => num(r[c])),
        num(r.total),
        num(r.unchecked),
        r.cashier_id ? `${r.reconciled_days} / ${r.days}` : "—",
        num(r.shortage),
        num(r.excess),
      ]);
      links = drill
        ? (data as CollectionsCashierRow[]).map((r) => [
            r.cashier_id ? `/collections?tab=pos` : null,
          ])
        : [];
      break;
    }
    case "shortages": {
      columns = [
        { label: t("date"), kind: "date" },
        { label: t("cashier"), kind: "text" },
        { label: t("number"), kind: "mono" },
        { label: t("recordedLabel"), kind: "money", sum: true },
        { label: t("actualLabel"), kind: "money", sum: true },
        ...CHANNEL_COLUMNS.map((c) => ({
          label: `${all(`collections.channels.${c}`)} ±`,
          kind: "money" as const,
          sum: true,
        })),
        { label: t("differenceLabel"), kind: "money", sum: true },
        { label: t("shortage"), kind: "money", sum: true },
        { label: t("excess"), kind: "money", sum: true },
        { label: t("status"), kind: "text" },
        { label: t("preparedBy"), kind: "text" },
        { label: t("approvedBy"), kind: "text" },
      ];
      rows = (data as ShortageRow[]).map((r) => [
        String(r.business_date).slice(0, 10),
        r.cashier,
        r.number,
        num(r.recorded),
        num(r.actual),
        ...CHANNEL_COLUMNS.map((c) => num(r[c])),
        num(r.difference),
        num(r.shortage),
        num(r.excess),
        label("collections.recon.status", r.status),
        r.prepared_by,
        r.approved_by,
      ]);
      links = (data as ShortageRow[]).map((r) => [
        null,
        null,
        `/collections/reconcile?cashier=${r.cashier_id}&date=${String(r.business_date).slice(0, 10)}`,
      ]);
      break;
    }
    case "unreconciled": {
      columns = [
        { label: t("receipt"), kind: "mono" },
        { label: t("date"), kind: "datetime" },
        { label: t("cashier"), kind: "text" },
        { label: t("method"), kind: "text" },
        { label: t("reference"), kind: "mono" },
        { label: t("pun"), kind: "mono" },
        { label: t("amount"), kind: "money", sum: true },
        { label: t("status"), kind: "text" },
        { label: t("ageDays"), kind: "int" },
        { label: t("disputeReason"), kind: "text" },
      ];
      rows = (data as UnreconciledRow[]).map((r) => [
        r.receipt_no,
        r.received_at,
        r.cashier === "Online" ? t("online") : r.cashier,
        label("collections.channels", r.channel),
        r.reference,
        r.pun,
        num(r.amount),
        label("collections.status", r.verify_status),
        num(r.age_days),
        r.dispute_reason,
      ]);
      links = (data as UnreconciledRow[]).map((r) => [
        to("payments", r.payment_id),
        null,
        null,
        null,
        null,
        to("parcels", r.parcel_id),
      ]);
      break;
    }
    case "certificates": {
      columns = [
        { label: t("serial"), kind: "mono" },
        { label: t("docType"), kind: "text" },
        { label: t("pun"), kind: "mono" },
        { label: t("owner"), kind: "text" },
        { label: t("district"), kind: "text" },
        { label: t("issuedAt"), kind: "datetime" },
        { label: t("issuedBy"), kind: "text" },
        { label: t("status"), kind: "text" },
      ];
      rows = (data as CertificateRow[]).map((r) => [
        r.serial,
        label("documents.types", r.type),
        r.pun,
        r.owner,
        pick(r as never, "district"),
        r.issued_at,
        r.issued_by,
        label("documents.status", r.status),
      ]);
      links = (data as CertificateRow[]).map((r) => [
        to("documents", r.document_id),
        null,
        to("parcels", r.parcel_id),
      ]);
      break;
    }
    case "parcels": {
      columns = [
        { label: t("pun"), kind: "mono" },
        { label: t("district"), kind: "text" },
        { label: t("neighbourhood"), kind: "text" },
        { label: t("houseNo"), kind: "text" },
        { label: t("area"), kind: "num", sum: true },
        { label: t("landUse"), kind: "text" },
        { label: t("grade"), kind: "text" },
        { label: t("status"), kind: "text" },
        { label: t("owners"), kind: "text" },
      ];
      rows = (data as ParcelRow[]).map((r) => [
        r.pun ?? t("noPun"),
        pick(r as never, "district"),
        pick(r as never, "neighbourhood"),
        fullHouseNo(r.neighbourhood_so, r.house_no),
        num(r.area_m2),
        label("stage.landUses", r.land_use),
        pick(r as never, "grade"),
        r.status === "registered"
          ? label("stage.parcelStatus", r.status)
          : `${label("stage.parcelStatus", r.status)} · ${t("partialShort")}`,
        r.owners,
      ]);
      links = (data as ParcelRow[]).map((r) => [to("parcels", r.parcel_id)]);
      break;
    }
    case "locations": {
      columns = [
        { label: t("level"), kind: "text" },
        { label: t("code"), kind: "mono" },
        { label: t("name"), kind: "text" },
        { label: t("district"), kind: "text" },
        { label: t("parcels"), kind: "int" },
        { label: t("registered"), kind: "int" },
        { label: t("partial"), kind: "int" },
        { label: t("boundary"), kind: "text" },
      ];
      rows = (data as LocationRow[]).map((r) => [
        t(`levels.${r.level}`),
        r.code,
        pick(r as never, "name"),
        pick(r as never, "district"),
        num(r.parcels),
        num(r.registered),
        num(r.partial),
        yesNo(r.has_boundary),
      ]);
      break;
    }
    case "owners": {
      columns = [
        { label: t("owner"), kind: "text" },
        { label: t("phone"), kind: "mono" },
        { label: t("idNumber"), kind: "mono" },
        { label: t("role"), kind: "text" },
        { label: t("share"), kind: "pct" },
        { label: t("pun"), kind: "mono" },
        { label: t("district"), kind: "text" },
        { label: t("neighbourhood"), kind: "text" },
        { label: t("area"), kind: "num", sum: true },
        { label: t("status"), kind: "text" },
      ];
      rows = (data as OwnerRow[]).map((r) => [
        r.owner,
        r.phone,
        r.id_number ? `${r.id_type ? `${r.id_type.replace(/_/g, " ")} ` : ""}${r.id_number}` : null,
        label("applications.roles", r.role),
        num(r.share_pct),
        r.pun ?? t("noPun"),
        pick(r as never, "district"),
        pick(r as never, "neighbourhood"),
        num(r.area_m2),
        label("stage.parcelStatus", r.status),
      ]);
      links = (data as OwnerRow[]).map((r) => [
        to("owners", r.party_id),
        null,
        null,
        null,
        null,
        to("parcels", r.parcel_id),
      ]);
      break;
    }
    case "transfers": {
      columns = [
        { label: t("number"), kind: "mono" },
        { label: t("pun"), kind: "mono" },
        { label: t("typeLabel"), kind: "text" },
        { label: t("fromOwners"), kind: "text" },
        { label: t("toOwners"), kind: "text" },
        { label: t("declaredValue"), kind: "money", sum: true },
        { label: t("district"), kind: "text" },
        { label: t("started"), kind: "date" },
        { label: t("decided"), kind: "date" },
        { label: t("decidedBy"), kind: "text" },
        { label: t("status"), kind: "text" },
        { label: t("dutyOwing"), kind: "money", sum: true },
      ];
      const r = data as TransferRow[];
      rows = r.map((x) => [
        x.number,
        x.pun,
        label("legal.transferKinds", x.kind),
        x.from_owners,
        x.to_owners,
        num(x.declared_value),
        pick(x as never, "district"),
        day(x.created_at),
        day(x.decided_at),
        x.decided_by,
        label("legal.status", x.status),
        num(x.duty_balance),
      ]);
      links = r.map((x) => [to("transfers", x.transfer_id), to("parcels", x.parcel_id)]);
      break;
    }
    case "demolished": {
      columns = [
        { label: t("number"), kind: "mono" },
        { label: t("pun"), kind: "mono" },
        { label: t("houseNo"), kind: "text" },
        { label: t("owners"), kind: "text" },
        { label: t("district"), kind: "text" },
        { label: t("neighbourhood"), kind: "text" },
        { label: t("demolishedOn"), kind: "date" },
        { label: t("reason"), kind: "text" },
        { label: t("status"), kind: "text" },
      ];
      const r = data as DemolishedRow[];
      rows = r.map((x) => [
        x.number,
        x.pun,
        fullHouseNo(x.neighbourhood_so, x.house_no),
        x.owners,
        pick(x as never, "district"),
        pick(x as never, "neighbourhood"),
        x.demolition_date,
        x.reason,
        x.rebuilt ? t("demolishedState.rebuilt") : t(`demolishedState.${x.status === "restored" ? "restored" : "demolished"}`),
      ]);
      links = r.map((x) => [to("demolished", x.demolition_id)]);
      break;
    }
    case "surveyZones": {
      columns = [
        { label: t("code"), kind: "mono" },
        { label: t("neighbourhood"), kind: "text" },
        { label: t("district"), kind: "text" },
        { label: t("surveyor"), kind: "text" },
        { label: t("target"), kind: "int", sum: true },
        { label: t("recordedHouses"), kind: "int", sum: true },
        { label: t("partial"), kind: "int", sum: true },
        { label: t("registered"), kind: "int", sum: true },
        { label: t("done"), kind: "pct" },
        { label: t("ownersWaiting"), kind: "int", sum: true },
        { label: t("assigned"), kind: "date" },
        { label: t("status"), kind: "text" },
      ];
      const r = data as SurveyZoneRow[];
      rows = r.map((x) => [
        x.code,
        pick(x as never, "name"),
        pick(x as never, "district"),
        x.surveyor,
        num(x.target),
        num(x.recorded),
        num(x.partial),
        num(x.registered),
        num(x.pct),
        num(x.owners_waiting),
        day(x.assigned_at),
        t(`zoneState.${x.status === "open" ? "open" : "done"}`),
      ]);
      links = r.map((x) => [to("surveys/zones", x.zone_id), to("surveys/zones", x.zone_id)]);
      break;
    }
    case "certificateStatus": {
      columns = [
        { label: t("pun"), kind: "mono" },
        { label: t("owner"), kind: "text" },
        { label: t("phone"), kind: "mono" },
        { label: t("district"), kind: "text" },
        { label: t("neighbourhood"), kind: "text" },
        { label: t("certificate"), kind: "text" },
        { label: t("serial"), kind: "mono" },
        { label: t("issuedAt"), kind: "date" },
        { label: t("expires"), kind: "date" },
        { label: t("owing"), kind: "money", sum: true },
      ];
      const r = data as CertificateStatusRow[];
      rows = r.map((x) => [
        x.pun,
        x.owner,
        x.phone,
        pick(x as never, "district"),
        pick(x as never, "neighbourhood"),
        t(`certState.${x.cert_status}`),
        x.serial,
        day(x.issued_at),
        x.expires_at,
        num(x.owing),
      ]);
      links = r.map((x) => [to("parcels", x.parcel_id)]);
      break;
    }
    case "staffActivity": {
      columns = [
        { label: t("staff"), kind: "text" },
        { label: t("roleLabel"), kind: "text" },
        { label: t("landAdded"), kind: "int", sum: true },
        { label: t("registered"), kind: "int", sum: true },
        { label: t("payments"), kind: "int", sum: true },
        { label: t("amount"), kind: "money", sum: true },
        { label: t("certificates"), kind: "int", sum: true },
        { label: t("decisions"), kind: "int", sum: true },
        { label: t("changes"), kind: "int", sum: true },
        { label: t("lastActive"), kind: "datetime" },
      ];
      const r = data as StaffActivityRow[];
      rows = r.map((x) => [
        x.staff,
        x.role,
        num(x.parcels_added),
        num(x.parcels_registered),
        num(x.payments),
        num(x.payments_amount),
        num(x.certificates),
        num(x.decisions),
        num(x.changes),
        x.last_active,
      ]);
      links = r.map((x) => [to("admin/users", x.user_id)]);
      break;
    }
    case "messages": {
      columns = [
        { label: t("messageKind"), kind: "text" },
        { label: t("channel"), kind: "text" },
        { label: t("total"), kind: "int", sum: true },
        { label: t("sent"), kind: "int", sum: true },
        { label: t("waiting"), kind: "int", sum: true },
        { label: t("failed"), kind: "int", sum: true },
        { label: t("stopped"), kind: "int", sum: true },
        { label: t("sentRate"), kind: "pct" },
      ];
      rows = (data as MessageRow[]).map((x) => [
        t.has(`messageKinds.${x.template_code}`) ? t(`messageKinds.${x.template_code}`) : x.template_code.replace(/_/g, " "),
        x.channel === "sms" ? "SMS" : x.channel === "whatsapp" ? "WhatsApp" : t("email"),
        num(x.total),
        num(x.sent),
        num(x.waiting),
        num(x.failed),
        num(x.cancelled),
        num(x.rate),
      ]);
      break;
    }
  }

  const hasSum = columns.some((c) => c.sum);
  const totals: Cell[] | null =
    hasSum && rows.length > 0
      ? columns.map((c, i) =>
          c.sum
            ? Math.round(rows.reduce((s, r) => s + (Number(r[i]) || 0), 0) * 100) / 100
            : i === 0
              ? t("total")
              : null,
        )
      : null;
  return { title: t(`names.${name}`), columns, rows, totals, links };
}
