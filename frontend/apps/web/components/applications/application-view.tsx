import type { ApplicationStatus } from "@dhulka/core/schemas";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@dhulka/ui/card";
import { TabsContent, TabsList, TabsTrigger } from "@dhulka/ui/form-controls";
import { Alert, PageHeader } from "@dhulka/ui/misc";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { getApplication } from "@/lib/server/applications";
import type { Viewer } from "@/lib/server/auth";
import { DecisionPanel } from "./decision-panel";
import { APPLICATION_TABS, DraftSteps, type ApplicationTab } from "./draft-steps";
import { DocumentsEditor } from "./documents-editor";
import { LocationForm } from "./location-form";
import { OwnersEditor } from "./owners-editor";
import { ReviewPanel } from "./review-panel";
import { StagePanel } from "./stage-panel";
import { ApplicationStatusBadge } from "./status-badge";
import { Timeline } from "./timeline";
import { UrlTabs } from "./url-tabs";

const OPEN_FOR_RETURN: ApplicationStatus[] = ["awaiting_payment", "in_survey", "surveyed", "in_verification"];
const CANCELLABLE: ApplicationStatus[] = ["draft", "awaiting_payment", "returned"];

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
  const { app, checklist, nearby, docTypes, stage } = data;
  const me = viewer.user.id;
  const isApplicant = app.citizen_user_id === me || app.created_by === me;
  const editableStatus = app.status === "draft" || app.status === "returned";
  const editable = editableStatus && (isApplicant || (mode === "staff" && viewer.can("applications.update")));
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
        actions={<DecisionPanel applicationId={app.id} allowed={allowed} />}
      />

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
      {app.status === "awaiting_payment" && (
        <Alert tone="info" title={t("awaitingPaymentTitle")} className="mb-5">
          {t("awaitingPaymentBody")}
        </Alert>
      )}

      {editable && <DraftSteps href={tabHref} checklist={checklist} current={tab} />}

      <StagePanel
        applicationId={app.id}
        status={app.status}
        feeStatus={app.fee_status}
        feeNote={app.fee_note}
        stage={stage}
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
