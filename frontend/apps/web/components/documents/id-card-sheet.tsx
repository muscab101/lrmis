import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import QRCode from "qrcode";
import type { DocumentDetail } from "@/lib/server/certificates";

/** CR80 property ID card (85.6 × 54 mm), front and back, print-ready for card printers. */
export async function IdCardSheet({ doc, verifyUrl }: { doc: DocumentDetail; verifyUrl: string }) {
  const t = await getTranslations("documents");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const lang = await getLocale();
  const s = doc.snapshot;
  const h = s.holder;
  const qr = await QRCode.toString(verifyUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0b1a3a", light: "#ffffff" } });
  const initials = (h?.full_name ?? "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  return (
    <div className="flex flex-col items-center gap-6 print:gap-[6mm]">
      <section className="relative h-[54mm] w-[85.6mm] overflow-hidden rounded-[3mm] bg-gradient-to-br from-[#0b2a8f] via-[#2a55d6] to-[#7c9cf0] p-[3.5mm] text-white shadow-md print:shadow-none">
        <div className="flex items-center gap-[2mm]">
          {/* eslint-disable-next-line @next/next/no-img-element -- print, static asset */}
          <img src="/brand/banadir-emblem-256.png" alt="" className="size-[9mm] rounded-sm bg-white/90 object-contain p-[0.5mm]" />
          <div className="leading-tight">
            <p className="text-[6.5pt] font-semibold uppercase">{tc("orgName")}</p>
            <p className="text-[6pt] opacity-90">{t("cardTitle")}</p>
          </div>
        </div>
        <div className="mt-[2.5mm] flex gap-[3mm]">
          <div className="grid h-[22mm] w-[18mm] shrink-0 place-items-center rounded-[1.5mm] bg-white/20 text-[14pt] font-semibold">{initials}</div>
          <dl className="min-w-0 text-[6.5pt] leading-[1.35]">
            <dt className="opacity-75">{t("name")}</dt>
            <dd className="truncate text-[8pt] font-semibold">{h?.full_name}</dd>
            <dt className="mt-[0.8mm] opacity-75">PUN</dt>
            <dd className="font-mono text-[7.5pt] font-semibold">{s.pun}</dd>
            <dt className="mt-[0.8mm] opacity-75">
              {t("district")} · {t("neighbourhood")}
            </dt>
            <dd className="truncate">
              {lang === "so" ? s.district.name_so : s.district.name_en} · {s.neighbourhood ? (lang === "so" ? s.neighbourhood.name_so : s.neighbourhood.name_en) : "—"}
            </dd>
          </dl>
        </div>
        <p className="absolute right-[3.5mm] bottom-[2.5mm] font-mono text-[6pt] opacity-90">{doc.serial}</p>
      </section>
      <section className="relative flex h-[54mm] w-[85.6mm] gap-[3mm] overflow-hidden rounded-[3mm] border border-neutral-300 bg-white p-[3.5mm] text-[#0b1a3a] shadow-md print:shadow-none">
        <div className="size-[26mm] shrink-0" dangerouslySetInnerHTML={{ __html: qr }} />
        <div className="text-[6.5pt] leading-[1.4]">
          <p className="font-semibold">{t("cardBackTitle")}</p>
          <p className="mt-[1mm]">{t("cardBackBody")}</p>
          <p className="mt-[1.5mm] opacity-75">{t("validUntil")}</p>
          <p className="font-semibold">{doc.expires_at ? format.dateTime(new Date(doc.expires_at), { dateStyle: "medium" }) : "—"}</p>
          <p className="mt-[1mm] font-mono">{doc.verify_code}</p>
        </div>
      </section>
    </div>
  );
}
