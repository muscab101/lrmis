import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ApplicationView } from "@/components/applications/application-view";
import { getApplication } from "@/lib/server/applications";
import { requireCitizen } from "@/lib/server/auth";
import { listDistricts } from "@/lib/server/users";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getApplication(id);
  return { title: data?.app.number ?? "404" };
}

export default async function PortalApplicationPage({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { locale, id } = await params;
  const { tab } = await searchParams;
  setRequestLocale(locale);
  const viewer = await requireCitizen(locale);
  const [data, districts] = await Promise.all([getApplication(id), listDistricts()]);
  // RLS already hides other people's applications; this keeps the portal to one's own.
  if (!data || data.app.citizen_user_id !== viewer.user.id) notFound();
  return <ApplicationView data={data} viewer={viewer} mode="citizen" districts={districts} tab={tab} basePath="/portal/applications" />;
}
