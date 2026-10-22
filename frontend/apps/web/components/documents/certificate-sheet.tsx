import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import QRCode from "qrcode";
import { type DocumentDetail, watermarkLine } from "@/lib/server/certificates";
import { ParcelMapSvg } from "./parcel-map-svg";

/** A4 title certificate (bilingual headings), rendered from the document's frozen snapshot. */
export async function CertificateSheet({ doc, verifyUrl }: { doc: DocumentDetail; verifyUrl: string }) {
  const t = await getTranslations("documents");
  const ts = await getTranslations("stage");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const lang = await getLocale();
  const s = doc.snapshot;
  const qr = await QRCode.toString(verifyUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0b1a3a", light: "#ffffff" } });
  const name = (o: { name_so: string; name_en: string } | null | undefined) => (o ? (lang === "so" ? o.name_so : o.name_en) : "—");
  const vertices = (s.geom.coordinates[0] ?? []).slice(0, -1);
  const mark = await watermarkLine(doc, lang);
  const facts: [string, string][] = [
    ["PUN", s.pun],
    [t("account"), s.account_no ?? "—"],
    [t("district"), name(s.district)],
    [t("neighbourhood"), name(s.neighbourhood)],
    [t("area"), s.area_m2 != null ? `${format.number(Number(s.area_m2), { maximumFractionDigits: 2 })} m²` : "—"],
    [t("landUse"), ts(`landUses.${s.land_use}`)],
    [t("plot"), s.plot_no ?? "—"],
    [t("registered"), s.registered_at ? format.dateTime(new Date(s.registered_at), { dateStyle: "long" }) : "—"],
  ];
  return (
    <article className="relative mx-auto flex h-[297mm] w-[210mm] flex-col overflow-hidden bg-white p-[14mm] text-[11.5px] text-[#0b1a3a] print:shadow-none">
      <div aria-hidden className="pointer-events-none absolute inset-[6mm] border-[3px] border-double border-[#1f45b8]/60" />
      {/* Security watermark: the owner and bill details tiled diagonally over the whole page, behind the content. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden select-none">
        <div className="absolute top-1/2 left-1/2 flex w-[200%] -translate-x-1/2 -translate-y-1/2 -rotate-30 flex-col gap-[7mm]">
          {Array.from({ length: 44 }, (_, i) => (
            <p key={i} className={`text-[12px] leading-none font-semibold tracking-[0.08em] whitespace-pre text-[#1f45b8]/[0.11] uppercase ${i % 2 ? "-ms-[40mm]" : ""}`}>
              {Array.from({ length: 5 }, () => mark).join("     ✦     ")}
            </p>
          ))}
        </div>
      </div>
      <header className="relative flex items-center justify-between gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- print, static asset */}
        <img src="/brand/banadir-emblem-256.png" alt="" className="size-20 object-contain" />
        <div className="text-center">
          <p className="text-[13px] font-semibold tracking-wide uppercase">{t("republic")}</p>
          <p className="text-[12px]">{tc("orgName")}</p>
          <h1 className="mt-2 text-[24px] leading-tight font-semibold tracking-tight">{t("certificateTitleSo")}</h1>
          <p className="text-[14px] font-medium text-[#1f45b8]">{t("certificateTitleEn")}</p>
        </div>
        <div className="w-20 text-end">
          <p className="text-[9px] text-neutral-500">{t("serial")}</p>
          <p className="font-mono text-[11px] font-semibold">{doc.serial}</p>
        </div>
      </header>

      <p className="relative mt-5 text-center text-[11px] text-neutral-700">{t("certifies")}</p>

      <section className="relative mt-4">
        <p className="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">{t("owners")}</p>
        <table className="mt-1 w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-300 text-[10px] text-neutral-500">
              <th className="py-1 text-start font-medium">{t("name")}</th>
              <th className="py-1 text-start font-medium">{t("motherName")}</th>
              <th className="py-1 text-start font-medium">{t("idDocument")}</th>
              <th className="py-1 text-end font-medium">{t("share")}</th>
            </tr>
          </thead>
          <tbody>
            {s.owners.map((o) => (
              <tr key={o.party_id} className="border-b border-neutral-200">
                <td className="py-1.5 font-semibold">{o.full_name}</td>
                <td className="py-1.5">{o.mother_name ?? "—"}</td>
                <td className="py-1.5 font-mono text-[10px]">{o.id_number ? `${o.id_type ?? ""} ${o.id_number}` : "—"}</td>
                <td className="py-1.5 text-end">{o.share_pct != null ? `${Number(o.share_pct)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="relative mt-5 grid grid-cols-[1fr_1.15fr] gap-6">
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1.5">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-neutral-500">{k}</dt>
              <dd className={k === "PUN" ? "font-mono text-[13px] font-semibold" : "font-medium"}>{v}</dd>
            </div>
          ))}
          <dt className="text-neutral-500">{t("centroid")}</dt>
          <dd className="font-mono text-[10px]">
            {s.centroid[1].toFixed(6)}, {s.centroid[0].toFixed(6)}
          </dd>
        </dl>
        <div>
          <ParcelMapSvg geom={s.geom} adjacent={s.adjacent} labels={{ north: t("north"), metres: "m" }} />
          <p className="mt-1 text-[9px] text-neutral-500">{t("mapNote")}</p>
        </div>
      </section>

      <section className="relative mt-4 grid grid-cols-2 gap-6">
        <div>
          <p className="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">{t("boundaries")}</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {(["north", "east", "south", "west"] as const).map((k) => (
              <div key={k} className="contents">
                <dt className="text-neutral-500">{t(`sides.${k}`)}</dt>
                <dd>{s.neighbours[k] || "—"}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <p className="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">{t("corners")}</p>
          <ol className="mt-1 grid grid-cols-2 gap-x-3 font-mono text-[9px]">
            {vertices.slice(0, 12).map((c, i) => (
              <li key={i}>
                {i + 1}. {c[1]!.toFixed(6)}, {c[0]!.toFixed(6)}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <footer className="relative mt-auto flex items-end justify-between gap-6 border-t border-neutral-300 pt-4">
        <div className="text-[10px]">
          <p className="text-neutral-500">{t("issuedOn")}</p>
          <p className="font-medium">{format.dateTime(new Date(doc.issued_at), { dateStyle: "long" })}</p>
          <p className="mt-3 text-neutral-500">{t("registrar")}</p>
          <p className="font-medium">{s.registrar ?? "—"}</p>
          <p className="mt-0.5 font-mono text-[9px] text-[#1f45b8]">
            {t("eSigned")} · {doc.verify_code.slice(0, 4)}-{doc.verify_code.slice(4, 8)}-{doc.verify_code.slice(8)}
          </p>
        </div>
        <div className="flex items-end gap-3">
          <p className="max-w-[48mm] text-end text-[9px] text-neutral-600">{t("verifyHint")}</p>
          <div className="size-[30mm] shrink-0" dangerouslySetInnerHTML={{ __html: qr }} />
        </div>
      </footer>
    </article>
  );
}
