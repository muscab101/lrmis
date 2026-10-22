import "server-only";
import { getTranslations } from "next-intl/server";
import type {
  ArrearsRow,
  BillingRow,
  CashierRow,
  CertificateRow,
  CollectionRow,
  IncomeRow,
  InvoiceRow,
  LocationRow,
  OwnerRow,
  ParcelRow,
  PaymentRow,
  RegistrationRow,
  ReportName,
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
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export async function reportTable(name: ReportName, data: unknown[], locale: string): Promise<ReportTable> {
  const t = await getTranslations({ locale, namespace: "reports" });
  const all = await getTranslations({ locale });
  const so = locale === "so";
  const pick = (r: Record<string, unknown>, base: string) => ((so ? r[`${base}_so`] : r[`${base}_en`]) as string | null) ?? null;
  /** A value label from an existing catalog section, or the raw value when there is none. */
  const label = (ns: string, v: string | null) => (v === null ? null : all.has(`${ns}.${v}`) ? all(`${ns}.${v}`) : v);
  const yesNo = (v: boolean | null) => (v === null ? null : v ? t("yes") : t("no"));

  let columns: Column[];
  let rows: Cell[][];
  switch (name) {
    case "revenue": {
      columns = [
        { label: t("month"), kind: "mono" },
        { label: t("feeType"), kind: "text" },
        { label: t("payments"), kind: "int", sum: true },
        { label: t("amount"), kind: "money", sum: true },
      ];
      rows = (data as RevenueRow[]).map((r) => [r.month, so ? r.fee_name_so : r.fee_name_en, num(r.payments), num(r.amount)]);
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
      rows = (data as IncomeRow[]).map((r) => [r.month, num(r.income), num(r.expenses), num(r.cash_in), num(r.cash_out), num(r.net)]);
      break;
    }
    case "arrears": {
      const buckets = ["not_due", "d1_30", "d31_90", "d91_180", "d180", "total"] as const;
      columns = [
        { label: t("district"), kind: "text" },
        { label: t("invoices"), kind: "int", sum: true },
        ...buckets.map((b) => ({ label: t(`buckets.${b}`), kind: "money" as const, sum: true })),
      ];
      rows = (data as ArrearsRow[]).map((r) => [pick(r as never, "district"), num(r.invoices), ...buckets.map((b) => num(r[b]))]);
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
      rows = (data as RegistrationRow[]).map((r) => [r.month, num(r.submitted), num(r.registered), num(r.rejected), num(r.median_days)]);
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
      rows = (data as CashierRow[]).map((r) => [r.cashier_name, num(r.shifts), num(r.payments), num(r.amount), num(r.difference)]);
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
      break;
    }
    case "payments": {
      columns = [
        { label: t("receipt"), kind: "mono" },
        { label: t("date"), kind: "datetime" },
        { label: t("pun"), kind: "mono" },
        { label: t("invoice"), kind: "mono" },
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
        label("payments.methods", r.method),
        r.cashier,
        r.point_of_sale,
        num(r.amount),
        label("payments.status", r.status),
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
        r.house_no,
        num(r.area_m2),
        label("stage.landUses", r.land_use),
        pick(r as never, "grade"),
        r.status === "registered" ? label("stage.parcelStatus", r.status) : `${label("stage.parcelStatus", r.status)} · ${t("partialShort")}`,
        r.owners,
      ]);
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
      break;
    }
  }

  const hasSum = columns.some((c) => c.sum);
  const totals: Cell[] | null =
    hasSum && rows.length > 0
      ? columns.map((c, i) => (c.sum ? Math.round(rows.reduce((s, r) => s + (Number(r[i]) || 0), 0) * 100) / 100 : i === 0 ? t("total") : null))
      : null;
  return { title: t(`names.${name}`), columns, rows, totals };
}
