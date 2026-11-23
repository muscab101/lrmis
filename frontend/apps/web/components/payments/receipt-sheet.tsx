import { getFormatter, getTranslations } from "next-intl/server";
import { capName } from "@/lib/cap-name";

export interface ReceiptSheetData {
  receipt_no: string;
  received_at: string;
  pos: string | null;
  pun: string | null;
  payer_name: string | null;
  method: string;
  reference: string | null;
  allocations: { id: string | number; number: string | null; amount: number }[];
  unallocated: number;
  amount: number;
  currency: string;
  status: string;
  /** The cashier who took the payment (null: paid online). */
  served_by?: string | null;
}

/** The receipt itself: narrow (fits 80 mm thermal printers and A4). Used on screen and by the print program. */
export async function ReceiptSheet({ r }: { r: ReceiptSheetData }) {
  const t = await getTranslations("payments");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  return (
    <article className="mx-auto max-w-[80mm] bg-white p-5 font-mono text-[12px] text-black shadow-sm print:shadow-none">
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- print sheet, static asset */}
        <img src="/brand/banadir-emblem-256.png" alt="" className="mx-auto size-12" />
        <p className="mt-1 font-sans text-sm font-semibold">{tc("orgName")}</p>
        <p className="font-sans text-[11px]">{t("officialReceipt")}</p>
      </div>
      <hr className="my-3 border-dashed border-black" />
      <p>{r.receipt_no}</p>
      <p>{format.dateTime(new Date(r.received_at), { dateStyle: "medium", timeStyle: "short" })}</p>
      {r.pos && <p>{r.pos}</p>}
      <hr className="my-3 border-dashed border-black" />
      <p>PUN {r.pun ?? "—"}</p>
      {r.payer_name && <p>{r.payer_name}</p>}
      <p>
        {t(`methods.${r.method}`)}
        {r.reference ? ` · ${r.reference}` : ""}
      </p>
      <hr className="my-3 border-dashed border-black" />
      {r.allocations.map((a) => (
        <p key={a.id} className="flex justify-between">
          <span>{a.number}</span>
          <span>{usd(a.amount)}</span>
        </p>
      ))}
      {Number(r.unallocated) > 0 && (
        <p className="flex justify-between">
          <span>{t("credit")}</span>
          <span>{usd(r.unallocated)}</span>
        </p>
      )}
      <p className="mt-2 flex justify-between text-sm font-bold">
        <span>{t("totalPaid")}</span>
        <span>{r.currency === "USD" ? usd(r.amount) : `${format.number(Number(r.amount))} ${r.currency}`}</span>
      </p>
      {r.status === "reversed" && <p className="mt-2 text-center font-bold">*** {t("status.reversed")} ***</p>}
      <hr className="my-3 border-dashed border-black" />
      <p className="text-center font-sans text-[11px]">
        {t("servedBy")}: {capName(r.served_by) ?? t("servedOnline")}
      </p>
      <p className="mt-1 text-center font-sans text-[11px]">{t("receiptThanks")}</p>
    </article>
  );
}
