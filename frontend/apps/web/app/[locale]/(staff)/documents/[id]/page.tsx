import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Alert, Mono, PageHeader } from "@dhulka/ui/misc";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { CertificateSheet } from "@/components/documents/certificate-sheet";
import { DocumentActions } from "@/components/documents/document-actions";
import { IdCardSheet } from "@/components/documents/id-card-sheet";
import { OpenInApp } from "@/components/documents/open-in-app";
import { ScreenshotShield } from "@/components/documents/screenshot-shield";
import { certificateHidden, inDesktopApp } from "@/lib/server/desktop";
import { PartyPhoto } from "@/components/owners/party-photo";
import { partyPhotoUrl } from "@/lib/server/party-photo";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { documentChanges, getDocument } from "@/lib/server/certificates";

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
  const changes = d.status === "valid" ? await documentChanges(d.id) : [];
  const pending = d.reprint_requests.find((r) => r.status === "pending") ?? null;
  const dt = (s: string) => format.dateTime(new Date(s), { dateStyle: "medium", timeStyle: "short" });
  const lang = await getLocale();
  const holder = d.type === "id_card" ? (d.snapshot.holder ?? null) : null;
  const photo = holder ? await partyPhotoUrl(holder.party_id) : null;
  const verifyUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/${lang}/verify/${d.verify_code}`;
  // Shown only inside the protected desktop app (when that is switched on).
  const hidden = await certificateHidden();
  const inApp = await inDesktopApp();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow={t(`types.${d.type}`)}
        title={<Mono>{d.serial}</Mono>}
        description={`${t(`status.${d.status}`)} · PUN ${d.snapshot.pun}${d.party ? ` · ${d.party.full_name}` : ""}`}
        actions={
          <DocumentActions
            id={d.id}
            status={d.status}
            can={{ reprint: viewer.can("certificates.reprint"), cancel: viewer.can("certificates.cancel") && d.issued_by !== viewer.user.id, direct: viewer.isSuperAdmin, print: viewer.can("certificates.print") }}
            printed={d.print_count > 0}
            changes={changes}
            pendingReason={pending?.reason ?? null}
          />
        }
      />
      {pending && (
        <Alert tone="info" title={t("pendingRequest", { kind: t(`requestKinds.${pending.kind}`) })} className="mb-5">
          {pending.reason} ·{" "}
          <Link href="/documents/print?tab=reprints" className="underline">
            {t("tabs.reprints")}
          </Link>
        </Alert>
      )}
      {d.status === "valid" && changes.length > 0 && !pending && (
        <Alert tone="warning" title={t("registerChanged")} className="mb-5">
          {t("registerChangedBody")}
        </Alert>
      )}
      {d.status === "cancelled" && (
        <Alert tone="warning" title={t("cancelledTitle")} className="mb-5">
          {d.cancel_reason}
        </Alert>
      )}
      {/* The document as it prints (screen copy marked PREVIEW; the official copy is printed from Print). */}
      <div className="mb-5 overflow-x-auto rounded-lg border bg-neutral-100 p-4 dark:bg-neutral-900">
        {hidden ? (
          <OpenInApp serial={d.serial} />
        ) : (
        <ScreenshotShield off={inApp}>
        <div className="relative mx-auto w-fit">
          {d.type === "certificate" ? <CertificateSheet doc={d} verifyUrl={verifyUrl} /> : <IdCardSheet doc={d} verifyUrl={verifyUrl} />}
          <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden">
            <span className={`-rotate-30 font-bold tracking-widest whitespace-nowrap text-red-600/15 select-none ${d.type === "certificate" ? "text-[64px]" : "text-[28px]"}`}>
              {t("previewWatermark")}
            </span>
          </div>
        </div>
        </ScreenshotShield>
        )}
      </div>
      {holder && (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle>{t("holderPhoto")}</CardTitle>
          </CardHeader>
          <CardContent>
            <PartyPhoto
              partyId={holder.party_id}
              url={photo}
              name={holder.full_name}
              canEdit={d.status === "valid" && (viewer.can("owners.update") || viewer.can("certificates.print"))}
            />
          </CardContent>
        </Card>
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
                    {t("requestLine", { kind: t(`requestKinds.${r.kind}`), status: t(`decision.${r.status}`) })} — {r.reason}
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
