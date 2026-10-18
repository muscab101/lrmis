import { Mono, PageHeader } from "@dhulka/ui/misc";
import { notFound } from "next/navigation";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { SurveyWorkspace } from "@/components/surveys/survey-workspace";
import { requirePermission } from "@/lib/server/auth";
import { getSurvey } from "@/lib/server/surveys";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("surveys");
  const data = await getSurvey(id);
  return { title: data?.survey.application?.number ? `${data.survey.application.number} · ${t("title")}` : t("title") };
}

export default async function SurveyPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "surveys.view");
  const t = await getTranslations("surveys");
  const lang = await getLocale();
  const data = await getSurvey(id);
  if (!data) notFound();
  const { survey, outline } = data;
  const canEdit = survey.surveyor_id === viewer.user.id && ["assigned", "in_progress", "returned"].includes(survey.status);
  const canReview = survey.status === "overlap_review" && viewer.can("surveys.approve") && viewer.can("map.edit_geometry");
  return (
    <>
      <PageHeader
        eyebrow={t("title")}
        title={<Mono>{survey.application?.number ?? "—"}</Mono>}
        description={`${t(`status.${survey.status}`)} · ${(lang === "so" ? survey.application?.neighbourhood?.name_so : survey.application?.neighbourhood?.name_en) ?? ""} ${survey.application?.address_note ?? ""}`}
      />
      <SurveyWorkspace key={survey.id} survey={survey} outline={outline} canEdit={canEdit} canReview={canReview} />
    </>
  );
}
