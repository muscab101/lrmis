import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import QRCode from "qrcode";
import { banadirOutlines, type DocumentDetail, watermarkLine, type WatermarkFacts } from "@/lib/server/certificates";
import { partyPhotoUrl } from "@/lib/server/party-photo";
import { BanadirMapSvg } from "./banadir-map-svg";
import { fullHouseNo } from "@/lib/house-no";

/**
 * CR80 property ID card (85.6 × 54 mm), print-ready for card printers.
 * Front: Banadir Regional Administration header and emblem, the holder, the land and the issue date.
 * Back: the Banadir region with the holder's district shaded and the house marked, and the verify QR.
 */
export async function IdCardSheet({
  doc,
  verifyUrl,
  agent,
}: {
  doc: DocumentDetail;
  verifyUrl: string;
  /** Printing through the print program there is no signed-in person: the page hands over what would be fetched. */
  agent?: { facts: WatermarkFacts; photoUrl: string | null; outlines: Awaited<ReturnType<typeof banadirOutlines>> };
}) {
  const t = await getTranslations("documents");
  const to = await getTranslations("owners");
  const [en, so] = await Promise.all([getTranslations({ locale: "en", namespace: "common" }), getTranslations({ locale: "so", namespace: "common" })]);
  const format = await getFormatter();
  const lang = await getLocale();
  const s = doc.snapshot;
  const h = s.holder;
  const [qr, outlines, mark, photo] = await Promise.all([
    QRCode.toString(verifyUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0b1a3a", light: "#ffffff" } }),
    agent ? agent.outlines : banadirOutlines(),
    watermarkLine(doc, lang, agent?.facts),
    // The holder's current photo, so one added after issue still prints.
    agent ? agent.photoUrl : partyPhotoUrl(h?.party_id),
  ]);
  const name = (o: { name_so: string; name_en: string } | null | undefined) => (o ? (lang === "so" ? o.name_so : o.name_en) : null);
  const initials = (h?.full_name ?? "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  const date = (v: string | null | undefined) => (v ? format.dateTime(new Date(v), { day: "2-digit", month: "short", year: "numeric" }) : "—");
  const id = h?.id_number ? `${h.id_type ? `${to(`id_${h.id_type}`)} ` : ""}${h.id_number}` : null;
  // Place: "House KRWJXL01 07" (the full number carries the neighbourhood); with no house number, the neighbourhood.
  const houseNo = fullHouseNo(s.neighbourhood?.code, s.house_no);
  const place =
    houseNo && houseNo !== s.house_no?.trim()
      ? t("cardHouse", { no: houseNo })
      : [name(s.neighbourhood), houseNo && t("cardHouse", { no: houseNo })].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col items-center gap-6 print:gap-[6mm]">
      {/* Front */}
      <section className="relative flex h-[54mm] w-[85.6mm] flex-col overflow-hidden rounded-[3mm] bg-[linear-gradient(115deg,#fdf0ff_0%,#e3f4ff_24%,#eefcdc_48%,#fff4d6_70%,#fde6f3_100%)] text-[#0b1a3a] shadow-md print:shadow-none">
        {/* Holographic sheen and the certificate's security watermark (owner, phone, house, bill, place) behind the text. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[conic-gradient(from_210deg_at_72%_28%,#ff9ad5,#9ad8ff,#b4f5b0,#ffe39a,#d9a8ff,#ff9ad5)] opacity-30 mix-blend-multiply" />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.55)_0_1.2mm,rgba(255,255,255,0)_1.2mm_3mm)] opacity-40" />
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden select-none">
          <div className="absolute top-1/2 left-1/2 flex w-[260%] -translate-x-1/2 -translate-y-1/2 -rotate-30 flex-col gap-[2.2mm]">
            {Array.from({ length: 22 }, (_, i) => (
              <p key={i} className={`text-[4.2pt] leading-none font-semibold whitespace-pre text-[#1f45b8]/[0.14] ${i % 2 ? "-ms-[18mm]" : ""}`}>
                {Array.from({ length: 4 }, () => mark).join("   ✦   ")}
              </p>
            ))}
          </div>
        </div>
        <header className="relative flex items-center gap-[2mm] bg-white/85 px-[3mm] py-[1.6mm] text-[#0b1a3a]">
          {/* eslint-disable-next-line @next/next/no-img-element -- print, static asset */}
          <img src="/brand/banadir-emblem-256.png" alt="" className="size-[8.5mm] object-contain" />
          <div className="min-w-0 flex-1 leading-[1.15]">
            <p className="text-[6.4pt] font-bold">{en("orgName")}</p>
            <p className="text-[5.6pt] font-semibold opacity-80">{so("orgName")}</p>
          </div>
          <p className="text-end text-[5pt] leading-tight font-semibold text-[#1f45b8]">{t("cardKind")}</p>
        </header>
        <div className="relative flex flex-1 gap-[2.5mm] px-[3mm] pt-[2mm]">
          <div className="grid h-[21mm] w-[17mm] shrink-0 place-items-center overflow-hidden rounded-[1.2mm] border border-[#1f45b8]/30 bg-white/60 text-[13pt] font-semibold text-[#1f45b8]">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- print, signed private-storage URL
              <img src={photo} alt="" className="size-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <dl className="grid min-w-0 flex-1 grid-cols-[auto_1fr] content-start gap-x-[1.5mm] gap-y-[0.35mm] text-[5.6pt] leading-[1.3]">
            <dt className="opacity-60">{t("name")}</dt>
            <dd className="truncate text-[7.2pt] leading-[1.1] font-semibold">{h?.full_name ?? "—"}</dd>
            {h?.mother_name && (
              <>
                <dt className="opacity-60">{t("motherName")}</dt>
                <dd className="truncate">{h.mother_name}</dd>
              </>
            )}
            {id && (
              <>
                <dt className="opacity-60">{t("cardId")}</dt>
                <dd className="truncate font-mono">{id}</dd>
              </>
            )}
            <dt className="opacity-60">PUN</dt>
            <dd className="truncate font-mono font-semibold">{s.pun}</dd>
            <dt className="opacity-60">{t("cardPlace")}</dt>
            <dd className="truncate">{place || "—"}</dd>
            <dt className="opacity-60">{t("issuedOn")}</dt>
            <dd>{date(doc.issued_at)}</dd>
          </dl>
        </div>
        <footer className="relative flex items-center justify-between bg-white/70 px-[3mm] py-[0.9mm] text-[5.2pt] text-[#0b1a3a]">
          <span className="font-mono">{doc.serial}</span>
          <span>
            {t("validUntil")} {date(doc.expires_at)}
          </span>
        </footer>
      </section>

      {/* Back */}
      <section className="relative flex h-[54mm] w-[85.6mm] gap-[2.5mm] overflow-hidden rounded-[3mm] border border-neutral-300 bg-white p-[3mm] text-[#0b1a3a] shadow-md print:shadow-none">
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="text-[6pt] font-bold">{t("cardMapTitle")}</p>
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
