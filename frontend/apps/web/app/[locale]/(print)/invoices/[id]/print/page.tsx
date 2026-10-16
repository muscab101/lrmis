import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import QRCode from "qrcode";
import { requirePermission } from "@/lib/server/auth";
import { getInvoice, getPayLink, parcelOwnersFor } from "@/lib/server/billing";
import { PrintButton } from "./print-button";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = await getInvoice(id);
  return { title: inv?.number ?? "404" };
}

/** A4 invoice for printing / PDF, with a QR code to the public pay page. */
export default async function InvoicePrintPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "invoices.print");
  const t = await getTranslations("billing");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const lang = await getLocale();
  const inv = await getInvoice(id);
  if (!inv) notFound();
  const [link, owners] = await Promise.all([getPayLink(inv.id), inv.parcel ? parcelOwnersFor(inv.parcel.id) : []]);
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const payUrl = link ? `${site}/${lang}${link}` : null;
  const qr = payUrl ? await QRCode.toString(payUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0b1a3a", light: "#ffffff" } }) : null;
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const date = (d: string) => format.dateTime(new Date(d), { dateStyle: "long" });
  const fee = inv.fee_type ? (lang === "so" ? inv.fee_type.name_so : inv.fee_type.name_en) : "";

  return (
    <div className="min-h-dvh bg-neutral-100 py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[210mm] justify-end print:hidden">
        <PrintButton label={t("print")} />
      </div>
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
            <p className="text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">{t("billedTo")}</p>
            <ul className="mt-1 space-y-0.5">
              {owners.map((o, i) => (
                <li key={i} className="font-medium">
                  {o.party?.full_name}
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
            <p className="text-neutral-600">
              {[inv.parcel?.neighbourhood && (lang === "so" ? inv.parcel.neighbourhood.name_so : inv.parcel.neighbourhood.name_en), inv.parcel?.district && (lang === "so" ? inv.parcel.district.name_so : inv.parcel.district.name_en)]
                .filter(Boolean)
                .join(", ")}
            </p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] content-start gap-x-6 gap-y-1">
            <dt className="text-neutral-500">{t("feeType")}</dt>
            <dd>
              {fee} {inv.period}
            </dd>
            <dt className="text-neutral-500">{t("issued")}</dt>
            <dd>{date(inv.issue_date)}</dd>
            <dt className="text-neutral-500">{t("dueDate")}</dt>
            <dd className="font-semibold">{date(inv.due_date)}</dd>
          </dl>
        </section>

        <table className="mt-8 w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-300 text-start text-[11px] tracking-wide text-neutral-500 uppercase">
              <th className="py-2 text-start font-semibold">{t("description")}</th>
              <th className="py-2 text-end font-semibold">{t("amount")}</th>
            </tr>
          </thead>
          <tbody>
            {inv.invoice_lines.map((l) => (
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
    </div>
  );
}
