import type { ApplicationStatus } from "@dhulka/core/schemas";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@dhulka/ui/card";
import { TabsContent, TabsList, TabsTrigger } from "@dhulka/ui/form-controls";
import { Button } from "@dhulka/ui/button";
import { Alert, PageHeader } from "@dhulka/ui/misc";
import { Link } from "@/i18n/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { listPropertyTypes } from "@/lib/server/property-types";
import type { getApplication } from "@/lib/server/applications";
import type { Viewer } from "@/lib/server/auth";
import { DecisionPanel } from "./decision-panel";
import { APPLICATION_TABS, DraftSteps, type ApplicationTab } from "./draft-steps";
import { DocumentsEditor } from "./documents-editor";
import { LocationForm } from "./location-form";
import { OwnersEditor } from "./owners-editor";
import { ReviewPanel } from "./review-panel";
import { SiteCheckActions } from "./site-check";
import { StagePanel } from "./stage-panel";
import { ApplicationStatusBadge } from "./status-badge";
import { CorrectLandButton, RebillButton } from "./billing-actions";
import { Timeline } from "./timeline";
import { UrlTabs } from "./url-tabs";

const OPEN_FOR_RETURN: ApplicationStatus[] = ["awaiting_payment", "in_survey", "surveyed", "in_verification"];
const CANCELLABLE: ApplicationStatus[] = ["draft", "awaiting_payment", "returned", "in_survey"];

interface Props {
  data: NonNullable<Awaited<ReturnType<typeof getApplication>>>;
  viewer: Viewer;
  mode: "staff" | "citizen";
  districts: { id: string; code: string; name_so: string; name_en: string }[];
  basePath: string;
  /** Open tab, from ?tab= (the step guide links to each tab). */
  tab?: string;
}

/** One application: details, owners, documents, review/submit, history and decisions. */
export async function ApplicationView({ data, viewer, mode, districts, basePath, tab: tabParam }: Props) {
  const t = await getTranslations("applications");
  const format = await getFormatter();
  const locale = await getLocale();
  const { app, checklist, nearby, docTypes, stage, fee } = data;
  const usdFmt = (n: number | string) => format.number(Number(n), { style: "currency", currency: "USD" });
  const propertyTypes = await listPropertyTypes();
  const me = viewer.user.id;
  const isApplicant = app.citizen_user_id === me || app.created_by === me;
  const editableStatus = app.status === "draft" || app.status === "returned";
  const editable = editableStatus && (isApplicant || (mode === "staff" && viewer.can("applications.update")));
  // Correct size and type (and re-bill) while staff review it, before the land is registered.
  const canCorrectLand = mode === "staff" && viewer.can("applications.update") && ["awaiting_payment", "in_survey", "surveyed", "in_verification", "public_notice"].includes(app.status);
  const requested = (APPLICATION_TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as ApplicationTab) : "details";
  const tab: ApplicationTab = requested === "review" && !editable ? "details" : requested;
  const tabHref = (k: ApplicationTab) => `${basePath}/${app.id}?tab=${k}`;

  const allowed: ("return" | "reject" | "cancel")[] = [];
  if (mode === "staff" && viewer.can("applications.update") && OPEN_FOR_RETURN.includes(app.status)) allowed.push("return");
  if (mode === "staff" && viewer.can("applications.approve") && !["draft", "approved", "rejected", "cancelled"].includes(app.status) && app.created_by !== me) {
    allowed.push("reject");
  }
  if (CANCELLABLE.includes(app.status) && (isApplicant || viewer.can("applications.cancel"))) allowed.push("cancel");

  const place = [
    app.neighbourhood ? (locale === "so" ? app.neighbourhood.name_so : app.neighbourhood.name_en) : null,
    app.district ? (locale === "so" ? app.district.name_so : app.district.name_en) : null,
  ]
    .filter(Boolean)
    .join(", ");

  const pin = app.pin ? { lon: app.pin.coordinates[0], lat: app.pin.coordinates[1], accuracy: app.pin_accuracy_m, method: app.pin_method } : null;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={t(`types.${app.type}`)}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{app.number}</span>
            <ApplicationStatusBadge status={app.status} />
          </span>
        }
        description={
          <>
            {place || t("noPlaceYet")} · {t(`channels.${app.channel}`)}
            {app.submitted_at && ` · ${t("submittedOn", { date: format.dateTime(new Date(app.submitted_at), { dateStyle: "medium" }) })}`}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {mode === "staff" && !app.site_check_status && (
              <SiteCheckActions
                application={app}
                me={me}
                can={{ request: viewer.can("applications.update"), checkAny: viewer.can("surveys.approve"), checkOwn: viewer.can("surveys.update") }}
                full
              />
            )}
            <DecisionPanel applicationId={app.id} allowed={allowed} />
          </div>
        }
      />

      {mode === "staff" && app.site_check_status && (() => {
        const siteCan = { request: viewer.can("applications.update"), checkAny: viewer.can("surveys.approve"), checkOwn: viewer.can("surveys.update") };
        const actions = <SiteCheckActions application={app} me={me} can={siteCan} full />;
        const done = app.site_check_done_at ? format.dateTime(new Date(app.site_check_done_at), { dateStyle: "medium" }) : "";
        return (
          <Alert
            tone={app.site_check_status === "pending" ? "warning" : app.site_check_status === "confirmed" ? "success" : "danger"}
            title={
              app.site_check_status === "pending"
                ? t("siteCheck.bannerPending")
                : app.site_check_status === "confirmed"
                  ? t("siteCheck.bannerConfirmed", { date: done })
                  : t("siteCheck.bannerNotFound", { date: done })
            }
            className="mb-5"
          >
            {app.site_check_note && <p>{app.site_check_note}</p>}
            <div className="mt-2 flex flex-wrap gap-2 empty:hidden">{actions}</div>
          </Alert>
        );
      })()}
      {app.status === "returned" && app.decision_note && (
        <Alert tone="warning" title={t("returnedTitle")} className="mb-5">
          {app.decision_note}
        </Alert>
      )}
      {app.status === "rejected" && app.decision_note && (
        <Alert tone="danger" title={t("rejectedTitle")} className="mb-5">
          {app.decision_note}
        </Alert>
      )}
      {/* Invoices raised on submit (tax bill + service charge). They're paid after registration; staff can correct and re-bill first. */}
      {(fee || canCorrectLand) && !["draft", "returned"].includes(app.status) && (
        <Alert tone={fee?.needs_rebill ? "warning" : "info"} title={t("invoicesTitle")} className="mb-5">
          {fee?.needs_rebill && fee.expected && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                {t("rebillNeeded", { amount: usdFmt(Number(fee.expected.tax) + Number(fee.expected.service)), current: usdFmt(fee.total_all ?? 0) })}
              </p>
              {canCorrectLand && <RebillButton applicationId={app.id} label={t("rebill")} />}
            </div>
          )}
          {fee && (fee.invoices?.length ?? 0) > 0 ? (
            <>
              <p>{Number(fee.balance_all ?? fee.balance) > 0 ? t("feeInvoicesBody", { amount: usdFmt(fee.balance_all ?? fee.balance) }) : t("invoicesPaidBody")}</p>
              <ul className="mt-3 divide-y rounded-md border bg-card">
                {(fee.invoices ?? []).map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 text-sm">
                    <div className="min-w-32 flex-1">
                      <div className="font-medium">{(locale === "so" ? inv.name_so : inv.name_en) || t("openInvoice")}</div>
                      <div className="text-muted-foreground font-mono text-xs">{inv.number}</div>
                    </div>
                    <div className="text-end tabular-nums">
                      <div className="font-semibold">{usdFmt(inv.total)}</div>
                      {Number(inv.balance) <= 0 ? (
                        <div className="text-success text-xs">{t("invoicePaid")}</div>
                      ) : (
                        Number(inv.balance) < Number(inv.total) && <div className="text-muted-foreground text-xs">{t("invoiceLeft", { amount: usdFmt(inv.balance) })}</div>
                      )}
                    </div>
                    {/* Long labels wrap on a phone instead of running out of the box. */}
                    <div className="flex w-full min-w-0 flex-wrap gap-2 xl:w-auto [&_a]:h-auto [&_a]:min-h-8 [&_a]:max-w-full [&_a]:whitespace-normal [&_a]:text-start">
                      {inv.pay_link && Number(inv.balance) > 0 && (
                        <Button size="sm" asChild>
                          <Link href={inv.pay_link}>{t("payOnline")}</Link>
                        </Button>
                      )}
                      {mode === "staff" && viewer.can("payments.create") && Number(inv.balance) > 0 && (
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/cashier?find=${inv.number}`}>{t("payAtCashier")}</Link>
                        </Button>
                      )}
                      {mode === "staff" && viewer.can("invoices.view") && (
                        <Button size="sm" variant="ghost" asChild>
                          <Link href={`/invoices/${inv.id}`}>{t("openInvoice")}</Link>
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {mode === "staff" && <p className="text-muted-foreground mt-2 text-xs">{t("payAfterRegistration")}</p>}
            </>
          ) : (
            <p className="text-sm">{t("noInvoicesYet")}</p>
          )}
          {canCorrectLand && (
            <div className="mt-3">
              <CorrectLandButton
                applicationId={app.id}
                widthM={app.plot_width_m != null ? Number(app.plot_width_m) : null}
                lengthM={app.plot_length_m != null ? Number(app.plot_length_m) : null}
                propertyType={app.property_type}
                propertyTypes={propertyTypes}
              />
            </div>
          )}
        </Alert>
      )}

      {editable && <DraftSteps href={tabHref} checklist={checklist} current={tab} />}

      <StagePanel
        applicationId={app.id}
        status={app.status}
        feeStatus={app.fee_status}
        feeNote={app.fee_note}
        stage={stage}
        defaultLandUse={app.land_use ?? undefined}
        me={me}
        staff={mode === "staff"}
        can={{
          waiveFee: mode === "staff" && viewer.can("payments.approve"),
          assignSurvey: mode === "staff" && viewer.can("surveys.approve"),
          verify: mode === "staff" && viewer.can("applications.approve"),
          register: mode === "staff" && viewer.can("parcels.approve"),
          resolveObjections: mode === "staff" && viewer.can("disputes.approve"),
          recordObjection: mode === "staff" && viewer.can("disputes.create"),
        }}
      />

      <UrlTabs value={tab}>
        <TabsList>
          <TabsTrigger value="details">{t("tabDetails")}</TabsTrigger>
          <TabsTrigger value="owners">
            {t("tabOwners")} ({app.application_parties.length})
          </TabsTrigger>
          <TabsTrigger value="documents">
            {t("tabDocuments")} ({app.application_documents.length})
          </TabsTrigger>
          {editable && <TabsTrigger value="review">{t("tabReview")}</TabsTrigger>}
          <TabsTrigger value="activity">{t("tabActivity")}</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <Card>
            <CardContent className="pt-5">
              <LocationForm
                mode="edit"
                applicationId={app.id}
                isStaff={mode === "staff"}
                basePath={basePath}
                districts={districts}
                propertyTypes={propertyTypes}
                readOnly={!editable}
                canCaptureLocation={mode === "citizen" || viewer.can("applications.capture_location")}
                captured={{ at: app.pin_captured_at, lowAccuracy: app.pin_low_accuracy }}
                initial={{
                  type: app.type,
                  channel: app.channel as "portal" | "office" | "field",
                  districtId: app.district_id,
                  neighbourhood: app.neighbourhood
                    ? { value: app.neighbourhood.id, label: locale === "so" ? app.neighbourhood.name_so : app.neighbourhood.name_en, hint: `${app.district?.code ?? ""}-${app.neighbourhood.code}` }
                    : null,
                  pin,
                  addressNote: app.address_note,
                  plotNo: app.plot_no ?? "",
                  oldDeedNo: app.old_deed_no ?? "",
                  govtFileNo: app.govt_file_no ?? "",
                  houseNo: app.house_no ?? "",
                  flatNo: app.flat_no ?? "",
                  govtReceiptNo: app.govt_receipt_no ?? "",
                  propertyType: app.property_type ?? "",
                  landUse: app.land_use ?? "",
                  plotWidthM: app.plot_width_m != null ? String(app.plot_width_m) : "",
                  plotLengthM: app.plot_length_m != null ? String(app.plot_length_m) : "",
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="owners">
          <Card>
            <CardHeader>
              <CardTitle>{t("ownersTitle")}</CardTitle>
              <CardDescription>{t("ownersHelp")}</CardDescription>
            </CardHeader>
            <CardContent>
              <OwnersEditor application={app} editable={editable} mode={mode} districts={districts} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardHeader>
              <CardTitle>{t("documentsTitle")}</CardTitle>
              <CardDescription>{t("documentsHelp")}</CardDescription>
            </CardHeader>
            <CardContent>
              <DocumentsEditor application={app} docTypes={docTypes} editable={editable} />
            </CardContent>
          </Card>
        </TabsContent>

        {editable && (
          <TabsContent value="review">
            <Card>
              <CardHeader>
                <CardTitle>{t("reviewTitle")}</CardTitle>
                <CardDescription>{t("reviewHelp")}</CardDescription>
              </CardHeader>
              <CardContent>
                <ReviewPanel applicationId={app.id} checklist={checklist} nearby={nearby} docTypes={docTypes} showNearbyLinks={mode === "staff"} />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="activity">
          <Card>
            <CardContent className="pt-6">
              <Timeline events={app.application_events} />
            </CardContent>
          </Card>
        </TabsContent>
      </UrlTabs>
    </div>
  );
}
