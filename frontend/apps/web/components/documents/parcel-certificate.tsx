import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Mono } from "@dhulka/ui/misc";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { parcelCertificate } from "@/lib/server/certificates";
import { IssueCertificateButton } from "./document-actions";

export async function ParcelCertificate({ parcelId, pun, canIssue }: { parcelId: string; pun: string; canIssue: boolean }) {
  const t = await getTranslations("documents");
  const format = await getFormatter();
  const { blockers, documents } = await parcelCertificate(parcelId);
  const valid = documents.filter((d) => d.status === "valid");
  const hasCert = valid.some((d) => d.type === "certificate");
  return (
    <Card id="certificate" className="scroll-mt-20">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">{t("parcelTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {hasCert ? t("hasCertificate") : blockers.length === 0 ? t("eligible") : `${t("notEligible")}: ${blockers.map((b) => t(`blockers.${b}`)).join(" · ")}`}
          </p>
        </div>
        {!hasCert && blockers.length === 0 && canIssue && <IssueCertificateButton parcelId={parcelId} pun={pun} />}
      </CardHeader>
      {documents.length > 0 && (
        <CardContent>
          <ul className="divide-y rounded-md border text-sm">
            {documents.map((d) => (
              <li key={d.id} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${d.status !== "valid" ? "text-muted-foreground" : ""}`}>
                <Link href={`/documents/${d.id}`} className="hover:text-primary">
                  <Mono>{d.serial}</Mono> <span className="ms-1">{t(`types.${d.type}`)}</span>
                  {d.party && <span className="ms-1 text-muted-foreground">· {d.party.full_name}</span>}
                </Link>
                <span className="text-xs">
                  {t(`status.${d.status}`)} · {format.dateTime(new Date(d.issued_at), { dateStyle: "medium" })}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
