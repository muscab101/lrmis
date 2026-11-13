import { useFormatter, useLocale, useTranslations } from "next-intl";

type Named = { name_so: string; name_en: string } | null;

/** What the A4 invoice shows. */
export interface InvoiceSheetData {
  number: string;
  period: string | null;
  issue_date: string;
  due_date: string;
  total: number;
  paid: number;
  credited: number;
  balance: number;
  discount_until: string | null;
  early_discount_pct: number | null;
  fee_type: Named;
  parcel: { pun: string | null; account_no: string | null; neighbourhood: Named; district: Named } | null;
  lines: { id: string; description: string; amount: number }[];
  owners: { share_pct: number | null; full_name: string | null }[];
}

/** The A4 invoice, with a QR code to the public pay page. Used on screen and by the print program. */
export function InvoiceSheet({ inv, payUrl, qr }: { inv: InvoiceSheetData; payUrl: string | null; qr: string | null }) {
  const t = useTranslations("billing");
  const tc = useTranslations("common");
  const format = useFormatter();
  const lang = useLocale();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const date = (d: string) => format.dateTime(new Date(d), { dateStyle: "long" });
  const name = (x: Named) => (x ? (lang === "so" ? x.name_so : x.name_en) : null);
  return (
    <article className="mx-auto flex min-h-[297mm] max-w-[210mm] flex-col bg-white p-[16mm] text-[13px] text-[#0b1a3a] shadow-sm print:min-h-0 print:shadow-none">
      <header className="flex items-start justify-between gap-6 border-b-2 border-[#0b1a3a] pb-5">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- print page, static asset */}
          <img src="/brand/banadir-emblem-256.png" alt="" className="size-16 object-contain" />
          <div>
            <p className="text-lg font-semibold">{tc("orgName")}</p>
            <p className="text-xs text-neutral-600">{t("printTagline")}</p>
          </div>
        </div>
        <div className="text-end">
          <p className="text-2xl font-semibold tracking-tight">{t("invoiceHeading")}</p>
          <p className="font-mono">{inv.number}</p>
        </div>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-8">
        <div>
          <p className="text-[11px] font-semibold text-neutral-500">{t("billedTo")}</p>
          <ul className="mt-1 space-y-0.5">
            {inv.owners.map((o, i) => (
              <li key={i} className="font-medium">
                {o.full_name}
                {o.share_pct != null && Number(o.share_pct) < 100 && <span className="text-neutral-500"> ({Number(o.share_pct)}%)</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2">
            PUN <span className="font-mono">{inv.parcel?.pun}</span>
          </p>
          <p>
            {t("account")} <span className="font-mono">{inv.parcel?.account_no}</span>
          </p>
          <p className="text-neutral-600">{[name(inv.parcel?.neighbourhood ?? null), name(inv.parcel?.district ?? null)].filter(Boolean).join(", ")}</p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-6 gap-y-1">
          <dt className="text-neutral-500">{t("feeType")}</dt>
          <dd>
            {name(inv.fee_type)} {inv.period}
          </dd>
          <dt className="text-neutral-500">{t("issued")}</dt>
          <dd>{date(inv.issue_date)}</dd>
          <dt className="text-neutral-500">{t("dueDate")}</dt>
          <dd className="font-semibold">{date(inv.due_date)}</dd>
        </dl>
      </section>

      <table className="mt-8 w-full border-collapse">
        <thead>
          <tr className="border-b border-neutral-300 text-start text-[11px] text-neutral-500">
            <th className="py-2 text-start font-semibold">{t("description")}</th>
            <th className="py-2 text-end font-semibold">{t("amount")}</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l) => (
            <tr key={l.id} className="border-b border-neutral-200">
              <td className="py-2">{l.description}</td>
              <td className="py-2 text-end tabular-nums">{usd(l.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="pt-3 text-end">{t("total")}</td>
            <td className="pt-3 text-end tabular-nums">{usd(inv.total)}</td>
          </tr>
          {Number(inv.paid) + Number(inv.credited) > 0 && (
            <tr>
              <td className="text-end">{t("paidOrCredited")}</td>
              <td className="text-end tabular-nums">−{usd(Number(inv.paid) + Number(inv.credited))}</td>
            </tr>
          )}
          <tr>
            <td className="pt-1 text-end text-base font-semibold">{t("amountDue")}</td>
            <td className="pt-1 text-end text-base font-semibold tabular-nums">{usd(inv.balance)}</td>
          </tr>
        </tfoot>
      </table>

      {inv.discount_until && Number(inv.early_discount_pct) > 0 && (
        <p className="mt-4 rounded border border-neutral-300 p-3 text-xs">{t("printDiscount", { pct: Number(inv.early_discount_pct), date: date(inv.discount_until) })}</p>
      )}

      <section className="mt-auto flex items-end justify-between gap-8 border-t border-neutral-300 pt-6">
        <div className="max-w-sm space-y-1 text-xs text-neutral-600">
          <p className="font-semibold text-[#0b1a3a]">{t("howToPay")}</p>
          <p>{t("howToPayBody", { pun: inv.parcel?.pun ?? "" })}</p>
          {payUrl && <p className="font-mono break-all">{payUrl}</p>}
        </div>
        {qr && <div className="size-28 shrink-0" aria-label={t("qrLabel")} dangerouslySetInnerHTML={{ __html: qr }} />}
      </section>
    </article>
  );
}

/** The QR code (SVG) for a pay page address. */
export async function payQr(payUrl: string | null) {
  if (!payUrl) return null;
  const QRCode = (await import("qrcode")).default;
  return QRCode.toString(payUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0b1a3a", light: "#ffffff" } });
}
