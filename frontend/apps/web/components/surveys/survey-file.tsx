import { StatusBadge } from "@dhulka/ui/badge";
import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Mono } from "@dhulka/ui/misc";
import { ClipboardList, FileText, Users } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ApplicationStatusBadge } from "@/components/applications/status-badge";
import { Link } from "@/i18n/navigation";
import type { SurveyFile } from "@/lib/server/surveys";
import type { ApplicationStatus } from "@dhulka/core/schemas";

/**
 * The surveyor's case file: what the registration staff entered (the application and its
 * owners) and the documents, next to the map. Changes still go through the application.
 */
export async function SurveyFileCards({ file, canOpenOwners }: { file: SurveyFile; canOpenOwners: boolean }) {
  const t = await getTranslations("surveys");
  const ta = await getTranslations("applications");
  const to = await getTranslations("owners");
  const format = await getFormatter();
  const lang = await getLocale();
  const nm = (o: { name_so: string; name_en: string } | null) => (o ? (lang === "so" ? o.name_so : o.name_en || o.name_so) : null);
  const owners = file.application_parties.filter((p) => p.party);
  const declared =
    file.plot_width_m && file.plot_length_m
      ? `${format.number(Number(file.plot_width_m))} × ${format.number(Number(file.plot_length_m))} m = ${format.number(Number(file.plot_width_m) * Number(file.plot_length_m), { maximumFractionDigits: 1 })} m²`
      : null;
  const facts: [string, React.ReactNode][] = [
    [ta("type"), ta(`types.${file.type}`)],
    [t("place"), [nm(file.neighbourhood), nm(file.district)].filter(Boolean).join(", ")],
    [t("declaredSize"), declared],
    [ta("plotNo"), file.plot_no],
    [ta("houseNo"), file.house_no],
    [ta("govtReceiptNo"), file.govt_receipt_no && <Mono key="gr">{file.govt_receipt_no}</Mono>],
    [ta("oldDeedNo"), file.old_deed_no],
    [ta("govtFileNo"), file.govt_file_no],
    [ta("addressNote"), file.address_note || null],
  ];
  const docName = (code: string) => {
    const d = file.docTypes.find((x) => x.code === code);
    return d ? (lang === "so" ? d.name_so : d.name_en) : code;
  };

  return (
    <section aria-label={t("caseTitle")} className="mb-5 grid gap-5 lg:grid-cols-3">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="text-muted-foreground size-4" aria-hidden />
              {t("caseApplication")}
            </CardTitle>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <Mono>{file.number}</Mono>
              <ApplicationStatusBadge status={file.status as ApplicationStatus} />
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={`/applications/${file.id}`}>{t("actionApplication")}</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {facts
              .filter(([, v]) => v !== null && v !== undefined && v !== "")
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="min-w-0 [overflow-wrap:anywhere]">{v}</dd>
                </div>
              ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="text-muted-foreground size-4" aria-hidden />
            {t("caseOwners")} ({owners.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {owners.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("caseNoOwners")}</p>
          ) : (
            <ul className="divide-y text-sm">
              {owners.map(({ party, role, share_pct }) => (
                <li key={party!.id} className="space-y-0.5 py-2 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {canOpenOwners ? (
                      <Link href={`/owners/${party!.id}`} className="hover:text-primary font-medium">
                        {party!.full_name}
                      </Link>
                    ) : (
                      <span className="font-medium">{party!.full_name}</span>
                    )}
                    <StatusBadge tone={party!.registered_at ? "approved" : "draft"}>
                      {party!.registered_at ? to("stateRegistered") : to("stateDraft")}
                    </StatusBadge>
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {[
                      `${ta(`roles.${role}`)}${share_pct ? ` · ${share_pct}%` : ""}`,
                      party!.mother_name && `${to("motherName")}: ${party!.mother_name}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  <div className="flex flex-wrap gap-x-3 font-mono text-xs">
                    {party!.phone && <span>{party!.phone}</span>}
                    {party!.id_number && <span>{party!.id_number}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="text-muted-foreground size-4" aria-hidden />
            {t("caseDocuments")} ({file.application_documents.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {file.application_documents.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("caseNoDocuments")}</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {file.application_documents.map((d) => (
                <li key={d.id} className="flex flex-wrap justify-between gap-x-3">
                  <span>{docName(d.doc_type)}</span>
                  <span className="text-muted-foreground min-w-0 truncate text-xs">{d.file_name}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href={`/applications/${file.id}?tab=documents`} className="text-primary mt-3 inline-block text-xs hover:underline">
            {t("caseOpenDocuments")}
          </Link>
        </CardContent>
      </Card>
    </section>
  );
}
