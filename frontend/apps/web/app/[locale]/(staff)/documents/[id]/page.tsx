import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Alert, Mono, PageHeader } from "@dhulka/ui/misc";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { DocumentActions } from "@/components/documents/document-actions";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { getDocument } from "@/lib/server/certificates";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getDocument(id);
  return { title: d?.serial ?? "404" };
}

export default async function DocumentPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "certificates.view");
  const t = await getTranslations("documents");
  const format = await getFormatter();
  const d = await getDocument(id);
  if (!d) notFound();
  const dt = (s: string) => format.dateTime(new Date(s), { dateStyle: "medium", timeStyle: "short" });
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow={t(`types.${d.type}`)}
        title={<Mono>{d.serial}</Mono>}
        description={`${t(`status.${d.status}`)} · PUN ${d.snapshot.pun}${d.party ? ` · ${d.party.full_name}` : ""}`}
        actions={<DocumentActions id={d.id} status={d.status} can={{ reprint: viewer.can("certificates.reprint"), cancel: viewer.can("certificates.cancel") && d.issued_by !== viewer.user.id }} />}
      />
      {d.status === "cancelled" && (
        <Alert tone="warning" title={t("cancelledTitle")} className="mb-5">
          {d.cancel_reason}
        </Alert>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardContent className="pt-5">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t("issuedOn")}</dt>
              <dd>{dt(d.issued_at)}</dd>
              {d.expires_at && (
                <>
                  <dt className="text-muted-foreground">{t("validUntil")}</dt>
                  <dd>{format.dateTime(new Date(d.expires_at), { dateStyle: "medium" })}</dd>
                </>
              )}
              <dt className="text-muted-foreground">{t("verifyCode")}</dt>
              <dd>
                <Link href={`/verify/${d.verify_code}`} className="underline" target="_blank">
                  <Mono>{d.verify_code}</Mono>
                </Link>
              </dd>
              <dt className="text-muted-foreground">PUN</dt>
              <dd>
                <Link href={`/parcels/${d.parcel?.id}`} className="underline">
                  <Mono>{d.snapshot.pun}</Mono>
                </Link>
              </dd>
              {d.replaces_id && (
                <>
                  <dt className="text-muted-foreground">{t("replaces")}</dt>
                  <dd>
                    <Link href={`/documents/${d.replaces_id}`} className="underline">
                      {t("previousDocument")}
                    </Link>
                  </dd>
                </>
              )}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("printLog")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {d.print_jobs.length === 0 ? (
              <p className="text-muted-foreground">{t("notPrinted")}</p>
            ) : (
              <ul className="space-y-1">
                {d.print_jobs.map((p) => (
                  <li key={p.id}>
                    {t(`printKind.${p.kind}`)} · {dt(p.printed_at)}
                  </li>
                ))}
              </ul>
            )}
            {d.reprint_requests.length > 0 && (
              <ul className="space-y-1 border-t pt-3">
                {d.reprint_requests.map((r) => (
                  <li key={r.id}>
                    {t("reprintLine", { status: t(`decision.${r.status}`) })} — {r.reason}
                    {r.new_document_id && (
                      <Link href={`/documents/${r.new_document_id}`} className="ms-2 underline">
                        {t("newDocument")}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
