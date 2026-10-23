import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import QRCode from "qrcode";
import { banadirOutlines, type DocumentDetail } from "@/lib/server/certificates";
import { BanadirMapSvg } from "./banadir-map-svg";

/**
 * CR80 property ID card (85.6 × 54 mm), print-ready for card printers.
 * Front: Banadir Regional Administration header and emblem, the holder, the land and the issue date.
 * Back: the Banadir region with the holder's district shaded and the house marked, and the verify QR.
 */
export async function IdCardSheet({ doc, verifyUrl }: { doc: DocumentDetail; verifyUrl: string }) {
  const t = await getTranslations("documents");
  const to = await getTranslations("owners");
  const [en, so] = await Promise.all([getTranslations({ locale: "en", namespace: "common" }), getTranslations({ locale: "so", namespace: "common" })]);
  const format = await getFormatter();
  const lang = await getLocale();
  const s = doc.snapshot;
  const h = s.holder;
  const [qr, outlines] = await Promise.all([
    QRCode.toString(verifyUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0b1a3a", light: "#ffffff" } }),
    banadirOutlines(),
  ]);
  const name = (o: { name_so: string; name_en: string } | null | undefined) => (o ? (lang === "so" ? o.name_so : o.name_en) : null);
  const initials = (h?.full_name ?? "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  const date = (v: string | null | undefined) => (v ? format.dateTime(new Date(v), { day: "2-digit", month: "short", year: "numeric" }) : "—");
  const id = h?.id_number ? `${h.id_type ? `${to(`id_${h.id_type}`)} ` : ""}${h.id_number}` : null;
  const place = [s.house_no && t("cardHouse", { no: s.house_no }), name(s.neighbourhood), name(s.district)].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col items-center gap-6 print:gap-[6mm]">
      {/* Front */}
      <section className="relative flex h-[54mm] w-[85.6mm] flex-col overflow-hidden rounded-[3mm] bg-gradient-to-br from-[#0b2a8f] via-[#1f45b8] to-[#3d6ee0] text-white shadow-md print:shadow-none">
        <header className="flex items-center gap-[2mm] bg-white px-[3mm] py-[1.6mm] text-[#0b1a3a]">
          {/* eslint-disable-next-line @next/next/no-img-element -- print, static asset */}
          <img src="/brand/banadir-emblem-256.png" alt="" className="size-[8.5mm] object-contain" />
          <div className="min-w-0 flex-1 leading-[1.15]">
            <p className="text-[6.4pt] font-bold tracking-[0.02em] uppercase">{en("orgName")}</p>
            <p className="text-[5.6pt] font-semibold uppercase opacity-80">{so("orgName")}</p>
          </div>
          <p className="text-end text-[5pt] leading-tight font-semibold text-[#1f45b8] uppercase">{t("cardKind")}</p>
        </header>
        <div className="flex flex-1 gap-[2.5mm] px-[3mm] pt-[2mm]">
          <div className="grid h-[21mm] w-[17mm] shrink-0 place-items-center rounded-[1.2mm] border border-white/40 bg-white/15 text-[13pt] font-semibold">{initials}</div>
          <dl className="grid min-w-0 flex-1 grid-cols-[auto_1fr] content-start gap-x-[1.5mm] gap-y-[0.35mm] text-[5.6pt] leading-[1.3]">
            <dt className="opacity-70">{t("name")}</dt>
            <dd className="truncate text-[7.2pt] leading-[1.1] font-semibold">{h?.full_name ?? "—"}</dd>
            {h?.mother_name && (
              <>
                <dt className="opacity-70">{t("motherName")}</dt>
                <dd className="truncate">{h.mother_name}</dd>
              </>
            )}
            {id && (
              <>
                <dt className="opacity-70">{t("cardId")}</dt>
                <dd className="truncate font-mono">{id}</dd>
              </>
            )}
            <dt className="opacity-70">PUN</dt>
            <dd className="truncate font-mono font-semibold">{s.pun}</dd>
            <dt className="opacity-70">{t("cardPlace")}</dt>
            <dd className="truncate">{place || "—"}</dd>
            <dt className="opacity-70">{t("issuedOn")}</dt>
            <dd>{date(doc.issued_at)}</dd>
          </dl>
        </div>
        <footer className="flex items-center justify-between bg-black/15 px-[3mm] py-[0.9mm] text-[5.2pt]">
          <span className="font-mono">{doc.serial}</span>
          <span>
            {t("validUntil")} {date(doc.expires_at)}
          </span>
        </footer>
      </section>

      {/* Back */}
      <section className="relative flex h-[54mm] w-[85.6mm] gap-[2.5mm] overflow-hidden rounded-[3mm] border border-neutral-300 bg-white p-[3mm] text-[#0b1a3a] shadow-md print:shadow-none">
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="text-[6pt] font-bold uppercase">{t("cardMapTitle")}</p>
          <div className="flex flex-1 items-center">
            <BanadirMapSvg districts={outlines} highlight={s.district.code} point={s.centroid} className="h-auto max-h-[36mm] w-full" />
          </div>
          <p className="text-[5.4pt]">
            <span className="me-[1mm] inline-block size-[2mm] rounded-full bg-[#dc2626] align-middle" aria-hidden />
            {place}
          </p>
        </div>
        <div className="flex w-[22mm] shrink-0 flex-col items-center text-center text-[5pt] leading-[1.3]">
          <div className="size-[20mm]" dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="mt-[1mm] font-semibold">{t("cardBackTitle")}</p>
          <p className="opacity-80">{t("cardBackShort")}</p>
          <p className="mt-[0.8mm] font-mono text-[5.2pt] font-semibold">{doc.verify_code}</p>
        </div>
      </section>
    </div>
  );
}
