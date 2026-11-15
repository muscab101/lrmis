import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { PrintButton } from "@/app/[locale]/(print)/invoices/[id]/print/print-button";
import { Link } from "@/i18n/navigation";
import { requireCitizen } from "@/lib/server/auth";
import { citizenReceipt } from "@/lib/server/portal";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await citizenReceipt(id);
  return { title: p?.receipt_no ?? "404" };
}

/** A citizen's own receipt: view it and print it (fits 80 mm printers and A4). */
export default async function CitizenReceiptPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireCitizen(locale);
  const t = await getTranslations("payments");
  const tp = await getTranslations("portal");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const p = await citizenReceipt(id);
  if (!p) notFound();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  return (
    <div className="min-h-dvh bg-neutral-100 py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[80mm] items-center justify-between print:hidden">
        <Link href="/portal" className="inline-flex items-center gap-1.5 text-sm text-neutral-700 hover:underline">
          <ArrowLeft className="size-4" aria-hidden />
          {tp("backToMyLand")}
        </Link>
        <PrintButton label={t("print")} />
      </div>
      <article className="mx-auto max-w-[80mm] bg-white p-5 font-mono text-[12px] text-black shadow-sm print:shadow-none">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- print page, static asset */}
          <img src="/brand/banadir-emblem-256.png" alt="" className="mx-auto size-12" />
          <p className="mt-1 font-sans text-sm font-semibold">{tc("orgName")}</p>
          <p className="font-sans text-[11px]">{t("officialReceipt")}</p>
        </div>
        <hr className="my-3 border-dashed border-black" />
        <p>{p.receipt_no}</p>
        <p>{format.dateTime(new Date(p.received_at), { dateStyle: "medium", timeStyle: "short" })}</p>
        {p.pos && <p>{p.pos.name}</p>}
        <hr className="my-3 border-dashed border-black" />
        <p>PUN {p.parcel?.pun ?? "—"}</p>
        {p.payer_name && <p>{p.payer_name}</p>}
        <p>
          {t(`methods.${p.method}`)}
          {p.reference ? ` · ${p.reference}` : ""}
        </p>
        <hr className="my-3 border-dashed border-black" />
        {p.payment_allocations.map((a) => (
          <p key={a.id} className="flex justify-between">
            <span>{a.invoice?.number}</span>
            <span>{usd(a.amount)}</span>
          </p>
        ))}
        {Number(p.unallocated) > 0 && (
          <p className="flex justify-between">
            <span>{t("credit")}</span>
            <span>{usd(p.unallocated)}</span>
          </p>
        )}
        <p className="mt-2 flex justify-between text-sm font-bold">
          <span>{t("totalPaid")}</span>
          <span>{p.currency === "USD" ? usd(p.amount) : `${format.number(Number(p.amount))} ${p.currency}`}</span>
        </p>
        {p.status === "reversed" && <p className="mt-2 text-center font-bold">*** {t("status.reversed")} ***</p>}
        <hr className="my-3 border-dashed border-black" />
        <p className="text-center font-sans text-[11px]">{t("receiptThanks")}</p>
      </article>
    </div>
  );
}
